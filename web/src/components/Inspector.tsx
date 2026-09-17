import { Suspense, lazy, useEffect, useState } from 'react';
import { Archive, FileCode2, Globe, Pencil, ScrollText, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input, Label, SectionTitle, Select, Textarea } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { actions, useApp } from '@/lib/store';
import { SAME_MACHINE } from '@/lib/token';
import type { ArmCall, CanvasNode } from '@/lib/types';
import { plural, t, type MessageKey } from '@i18n';
import { formatDateTime } from '@i18n/fmt';

/**
 * The costume picker draws with the cast, so it comes from the OFFICE CHUNK
 * through a lazy import. A direct import would pull the whole room into the main
 * bundle and undo the code split for everybody, including people who switched
 * the room off. → `office/CharacterPicker.tsx` · SPEC-office-animation §11c②
 */
const CharacterPickerLazy = lazy(() => import('@/office/CharacterPicker'));

/**
 * Renders nothing at all when the company has no office view: a costume for a
 * view that does not exist is a control with no consequence, and offering one
 * is how a setting turns into a lie.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ TWO CONDITIONS, AND THEY ARE NOT THE SAME QUESTION. → SPEC §17i        │
 * │                                                                          │
 * │   `officeView`   does this door EXIST for this company (company.yaml)    │
 * │   `view`         is the user LOOKING at it right now (localStorage)      │
 * │                                                                          │
 * │ The second was missing, so somebody editing an employee on the DIAGRAM   │
 * │ was offered a row of faces for a room they had not opened — and the      │
 * │ result of the change was invisible until they switched. A control whose  │
 * │ effect you cannot see is a control you press twice.                      │
 * │                                                                          │
 * │ ⚠ It also keeps the code split honest in the common case: a user who     │
 * │ never opens the room never mounts this, so the cast chunk is never       │
 * │ fetched — which `officeView` alone did not guarantee.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function CharacterPicker({ node }: { node: CanvasNode }) {
  const enabled = useApp((s) => s.company?.officeView !== false && s.view === 'office');
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <CharacterPickerLazy node={node} />
    </Suspense>
  );
}

/**
 * Edit an employee's profile in place. → docs/SPEC-tools-approval.md §1
 *
 * NO autosave. Editing `pitch` bumps the assistant's cacheKey (the pitch sits in
 * its roster). The Save button is explicit and states the price — the same rule
 * as skills.
 *
 * The model tier is DELIBERATELY no longer in this form: it has its own control
 * (`ModelPicker`), in exactly one place, shared with the assistant. One thing
 * editable in two places always ends up with one of them forgotten when the rule
 * changes.
 */
function AgentProfile({ node }: { node: CanvasNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(node.label);
  const [pitch, setPitch] = useState(node.pitch ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(node.label);
    setPitch(node.pitch ?? '');
    setOpen(false);
  }, [node.id, node.label, node.pitch]);

  const dirty = name !== node.label || pitch !== (node.pitch ?? '');

  if (!open) {
    return (
      <>
        {node.pitch && <Note>{node.pitch}</Note>}
        <button
          className="mb-3 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {t('inspector.editProfile')}
        </button>
      </>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <Label htmlFor="ag-name">{t('inspector.displayName')}</Label>
      <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} />

      <Label htmlFor="ag-pitch" className="mt-3">
        {t('inspector.pitch')}
      </Label>
      <Textarea id="ag-pitch" rows={3} value={pitch} onChange={(e) => setPitch(e.target.value)} />

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || !pitch.trim() || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await actions.editAgent(node.role!, {
              display_name: name.trim(),
              pitch: pitch.trim(),
            });
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Rename the assistant.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS CONTROL DELIBERATELY HAS *NO* CACHE WARNING — and that is           │
 * │ information.                                                             │
 * │                                                                          │
 * │ It sits directly above `ModelPicker`, which carries a whole paragraph    │
 * │ about the cache. Two buttons identical in shape and utterly different in │
 * │ price: `display_name` **is in nobody's prompt** (the roster lists only   │
 * │ EMPLOYEES), so changing it rewrites no cache, loses no memory and touches│
 * │ no session.                                                              │
 * │                                                                          │
 * │ Pasting one generic warning onto both teaches the user to skip warnings  │
 * │ — and then they skip the one worth reading. The silence here is a choice.│
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function AssistantName({ node }: { node: CanvasNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(node.label);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(node.label);
    setOpen(false);
  }, [node.id, node.label]);

  const trimmed = name.replace(/\s+/g, ' ').trim();

  if (!open) {
    return (
      <button
        className="mb-3 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
        {t('inspector.renameAssistant')}
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <Label htmlFor="as-name">{t('inspector.displayName')}</Label>
      <Input
        id="as-name"
        autoFocus
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('inspector.assistantNamePlaceholder')}
      />
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        {t('inspector.assistantNameNoteBefore')} <b>{t('inspector.assistantNameNoteBold')}</b>{' '}
        {t('inspector.assistantNameNoteAfter')}
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!trimmed || trimmed === node.label || busy}
          onClick={async () => {
            setBusy(true);
            const ok = await actions.renameAssistant(trimmed);
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE MANUAL SIGN-IN DOOR — opens an ORDINARY browser window on the very   │
 * │ profile an employee uses. → `core/browser-login.ts`                      │
 * │                                                                          │
 * │ The case that produced it (user, 29/08, four attempts): *"I'm halfway    │
 * │ through signing in with my phone number, wait a second"* · *"it closes on │
 * │ me right at the address step"*. An employee's browser lifetime = the      │
 * │ lifetime of ONE TASK, so there is no room inside it for a human to act.  │
 * │                                                                          │
 * │ ⚠ This button takes NO password and never may: taking one turns agentco   │
 * │ into a password holder. It opens exactly one window at exactly one URL.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function BrowserLogin() {
  const officeId = useApp((s) => s.officeId);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);

  if (!officeId) return null;
  return (
    <div className="mb-3 rounded-lg border border-line p-3">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 shrink-0 text-muted" />
        <span className="text-[13px] font-medium">{t('inspector.browserLoginTitle')}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        {opened ? (
          <>
            {t('inspector.browserOpenedBefore')} <b>{t('inspector.browserOpenedBold')}</b>{' '}
            {t('inspector.browserOpenedAfter')}
          </>
        ) : (
          <>
            {t('inspector.browserIdleBefore')} <b>{t('inspector.browserIdleBold')}</b>{' '}
            {t('inspector.browserIdleAfter')}
          </>
        )}
      </p>
      {err && <p className="mt-1.5 text-xs text-danger">{err}</p>}
      {/*
        ⚠ SAY IT BEFORE THE CLICK, NOT AFTER. This window opens where the DAEMON
        runs, so over a remote connection — and a container is one — it would
        appear where nobody is looking. The server refuses it either way
        (`srv.browserLoginLocalOnly`); what was wrong was letting the user press
        a button whose answer was already known, and learning why from an error.
        Same rule as the `loopbackOnly` checkbox in `ArmDialog`, which hides
        itself and explains instead. (18/09/2026)
      */}
      {!SAME_MACHINE ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">{t('srv.browserLoginLocalOnly')}</p>
      ) : (
        <Button
          size="sm"
          variant="primary"
          className="mt-3"
          disabled={busy}
          onClick={() => void go()}
        >
          {busy
            ? t('inspector.browserOpening')
            : opened
              ? t('inspector.browserReopen')
              : t('inspector.browserOpen')}
        </Button>
      )}
    </div>
  );

  async function go() {
    setBusy(true);
    setErr('');
    try {
      // No `url`: opening the office's browser is enough, and the user types the
      // address in the window. Asking them to type it first adds a step for the
      // same result.
      await api.browserLogin(officeId!);
      setOpened(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE AUDIT LOG — AND WHY IT LIVES HERE rather than in its own drawer.      │
 * │ (the user asked 26/08: *"which object on the UI should own it?"*)         │
 * │                                                                           │
 * │ The three left-hand drawers (Results · Library · Knowledge) are all       │
 * │ **the user's content**. A log is not content — a fourth drawer makes      │
 * │ EVERYONE learn one more concept, including people who will never open it. │
 * │ Exactly what the user warned about: *"a no-code person walks in and       │
 * │ understands none of it"*.                                                 │
 * │                                                                           │
 * │ The right place is **the object that owns the risk**: the arm. This panel │
 * │ already says *"what it CAN do"* (the level badge, the tool count); the    │
 * │ log says *"what it HAS done"*. Two halves of one question, so they stand  │
 * │ next to each other.                                                       │
 * │                                                                           │
 * │ And it **tiers the audience by itself** with no "advanced" mode: you have │
 * │ to click a 🔌 node to see it, and anyone clicking a 🔌 node has already   │
 * │ crossed that threshold.                                                   │
 * │                                                                           │
 * │ ⚠ CLOSED by default. It can run to hundreds of lines, and the inspector   │
 * │ is where people come to rename something or pull a wire — not to read a   │
 * │ log.                                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function ArmLog({ server }: { server: string }) {
  const officeId = useApp((s) => s.officeId);
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<ArmCall[] | null>(null);

  // Load only when OPENED: a long-running arm has hundreds of rows, and
  // pre-loading on every node click pays for something almost nobody looks at.
  useEffect(() => {
    if (!open || !officeId) return;
    setCalls(null);
    api
      .armLog(officeId, server)
      .then((r) => setCalls(r.calls))
      .catch(() => setCalls([]));
  }, [open, officeId, server]);

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button
        className="flex w-full items-center gap-1.5 text-[13px] text-accent hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        <ScrollText className="h-3.5 w-3.5" />
        {open ? t('inspector.hideLog') : t('inspector.showLog')}
      </button>

      {open && (
        <div className="mt-2">
          {calls === null && <p className="text-xs text-muted">{t('common.reading')}</p>}
          {calls?.length === 0 && (
            <p className="text-xs leading-relaxed text-muted">
              {t('inspector.noCallsBefore')} <b>{t('inspector.noCallsBold')}</b>{' '}
              {t('inspector.noCallsAfter')}
            </p>
          )}
          {calls?.map((c, i) => (
            <ArmLogRow key={`${c.ts}-${i}`} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One row: **WHO · DID WHAT · WHEN**, with the arguments one click away.
 *
 * The arguments are the log's most valuable part (they answer *"WHAT did it write
 * into Notion"*) and also its longest. Laid out in full, 20 calls become a wall of
 * JSON and people stop reading — which loses the rows worth reading too.
 */
function ArmLogRow({ call }: { call: ArmCall }) {
  const [show, setShow] = useState(false);
  const when = new Date(call.ts);
  const stamp = Number.isNaN(when.getTime()) ? call.ts : formatDateTime(when);

  return (
    <div className="border-b border-line/60 py-1.5 last:border-0">
      <button className="w-full text-left" onClick={() => setShow((v) => !v)}>
        <div className="flex items-baseline gap-1.5 text-[12.5px]">
          {/* The tool name VERBATIM, never through a hand-written translation
              table: such a table is right for one vendor and silent for every
              other — the same argument as `describeCall`. */}
          <span className="min-w-0 flex-1 truncate font-medium">{call.tool.replace(/_/g, ' ')}</span>
          <span className="flex-none tabular-nums text-[11px] text-muted">{stamp}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {call.role}
          {call.task_id ? ` · ${call.task_id}` : ''}
        </div>
      </button>
      {show && (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-line/40 p-2 text-[11px] leading-relaxed text-ink">
          {pretty(call.args)}
          {call.truncated ? t('inspector.argsTruncated') : ''}
        </pre>
      )}
    </div>
  );
}

/** Pretty-print the JSON; if it is broken show it verbatim — never swallow the only thing left. */
function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Keys, not sentences — a module-level string would freeze the load-time locale. */
const TIER_HINT: Record<string, MessageKey> = {
  eco: 'inspector.tier.eco',
  standard: 'inspector.tier.standard',
  deep: 'inspector.tier.deep',
};

/**
 * The model picker. ONE component for both the assistant and employees.
 * → docs/SPEC-offices.md §4.5
 *
 * The two sides differ in exactly two ways, and both are FACTS about the price:
 *
 *  - The assistant has a "follow the company default" option, and changing it
 *    loses the prompt cache for one turn (it runs `resume`, so that turn resends
 *    the whole transcript). Memory is NOT lost — the transcript is on disk,
 *    independent of the model.
 *  - An employee is a stateless function: changing its model loses nothing.
 *
 * Say that difference rather than one generic warning, because a generic one
 * either frightens the user where there is nothing to fear or reassures them
 * where there is.
 */
function ModelPicker({ node }: { node: CanvasNode }) {
  const isAssistant = node.kind === 'assistant';
  const companyDefault = useApp((s) => s.company?.models.master ?? 'standard');
  const models = useApp((s) => s.company?.models);
  const [open, setOpen] = useState(false);
  const current = isAssistant && node.tierInherited ? '' : (node.tier ?? 'standard');
  const [tier, setTier] = useState(current);
  const [busy, setBusy] = useState(false);
  // Kept as a STRING while typing: number state turns "" into 0 mid-edit, and 0
  // here means "no limit" — so clearing the field to retype it would silently
  // remove the ceiling.
  const [usd, setUsd] = useState(String(node.maxUsd ?? 0));
  const [turns, setTurns] = useState(String(node.maxTurns ?? 6));

  useEffect(() => {
    setTier(isAssistant && node.tierInherited ? '' : (node.tier ?? 'standard'));
    setUsd(String(node.maxUsd ?? 0));
    setTurns(String(node.maxTurns ?? 6));
    setOpen(false);
  }, [node.id, node.tier, node.tierInherited, node.maxUsd, node.maxTurns, isAssistant]);

  const usdNum = Number(usd);
  const turnsNum = Number(turns);
  const limitsOk =
    Number.isFinite(usdNum) && usdNum >= 0 && Number.isInteger(turnsNum) && turnsNum >= 1;
  const limitsDirty = !isAssistant && (usdNum !== (node.maxUsd ?? 0) || turnsNum !== (node.maxTurns ?? 6));

  const effective = tier || companyDefault;

  if (!open) {
    return (
      <>
        <Row
          k={t('inspector.modelTier')}
          v={
            <>
              {node.tier}
            </>
          }
        />
        <Row
          k={t('inspector.model')}
          v={<span className="font-mono text-[11.5px]">{node.model}</span>}
        />
        {!isAssistant && (
          <Row
            k={t('inspector.perJobLimit')}
            v={
              <>
                {node.maxUsd
                  ? t('inspector.maxUsd', { n: node.maxUsd })
                  : t('inspector.noMoneyLimit')}
                {` · ${plural('inspector.stepCount', node.maxTurns ?? 6)}`}
              </>
            }
          />
        )}
        <button
          className="mt-2 flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
          {isAssistant ? t('inspector.changeModel') : t('inspector.changeModelLimits')}
        </button>
      </>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-line p-3">
      <Label htmlFor="tier-pick">{t('inspector.modelTier')}</Label>
      <Select
        id="tier-pick"
        className="w-full"
        value={tier}
        onChange={(e) => setTier(e.target.value)}
      >
        {isAssistant && (
          <option value="">{t('inspector.companyDefault', { default: companyDefault })}</option>
        )}
        <option value="eco">{t(TIER_HINT['eco']!)}</option>
        <option value="standard">{t(TIER_HINT['standard']!)}</option>
        <option value="deep">{t(TIER_HINT['deep']!)}</option>
      </Select>
      {models && (
        <p className="mt-1.5 font-mono text-[11.5px] text-muted">
          {models[effective as 'eco' | 'standard' | 'deep']}
        </p>
      )}

      {/*
        The limits share a control with the model tier rather than getting their
        own screen: changing tier is the only moment the user is thinking about
        price, and the same job on `deep` costs several times what it does on
        `eco`. Splitting them makes the user remember to come back and edit twice.
      */}
      {!isAssistant && (
        <div className="mt-4 border-t border-line pt-3">
          <Label htmlFor="lim-usd">{t('inspector.limitOneJob')}</Label>
          <div className="mt-1.5 flex gap-2">
            <div className="flex-1">
              <Input
                id="lim-usd"
                type="number"
                min="0"
                step="0.5"
                value={usd}
                onChange={(e) => setUsd(e.target.value)}
              />
              <p className="mt-1 text-[11.5px] text-muted">{t('inspector.maxSpendHint')}</p>
            </div>
            <div className="flex-1">
              <Input
                id="lim-turns"
                type="number"
                min="1"
                step="1"
                value={turns}
                onChange={(e) => setTurns(e.target.value)}
              />
              <p className="mt-1 text-[11.5px] text-muted">{t('inspector.maxStepsHint')}</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !limitsOk || (tier === current && !limitsDirty)}
          onClick={async () => {
            setBusy(true);
            const ok = isAssistant
              ? await actions.setAssistantTier(tier || null)
              : await actions.editAgent(node.role!, {
                  model_tier: tier,
                  max_usd: usdNum,
                  max_turns: turnsNum,
                });
            setBusy(false);
            if (ok) setOpen(false);
          }}
        >
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}


/**
 * The `Bash` switch. → docs/SPEC-tools-approval.md §5
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONLY CAPABILITY SWITCH IN THE WHOLE PRODUCT — and that is deliberate.│
 * │                                                                          │
 * │ The other six tools are on and cannot be turned off, because they only   │
 * │ touch the office directory or only read the web. Asking a user to enable │
 * │ `WebSearch` for an employee called "Researcher" asks a question with one │
 * │ possible answer.                                                         │
 * │                                                                          │
 * │ `Bash` differs in KIND, not in degree: it is the only thing that can     │
 * │ leave the office. Specifically — and this has to be said in the          │
 * │ interface, not only in the spec:                                         │
 * │                                                                          │
 * │  · THE RULE "artifacts are always produced inside the office" is         │
 * │    enforced by a `PreToolUse` hook matching `Write|Edit|NotebookEdit`    │
 * │    (worker.ts §officeJail). `Bash` is NOT in that matcher and cannot be: │
 * │    a shell command's path lives inside the command string, not in a      │
 * │    named field. Turning this on opens a door that hook does not watch.   │
 * │  · The `write_external` approval gate in SPEC §8 is NOT BUILT YET. So    │
 * │    today there is no blocking layer behind this switch at all.           │
 * │                                                                          │
 * │ ⇒ The warning here is not procedure. It is the ONLY protective layer, so │
 * │   it states the REAL consequence ("read and write anywhere on your       │
 * │   machine") instead of something generic like "please consider".         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function BashSwitch({ node }: { node: CanvasNode }) {
  const on = !!node.bash;
  const [busy, setBusy] = useState(false);

  return (
    <div className={`mt-4 rounded-lg border p-3 ${on ? 'border-warn' : 'border-line'}`}>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 flex-none accent-accent"
          checked={on}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            await actions.editAgent(node.role!, { bash: e.target.checked });
            setBusy(false);
          }}
        />
        {/*
          Just the label now. The capability description was dropped on 02/09 (the
          app was drowning in text) — what stayed is the WARNING right below, and
          it only appears when the switch is ON. One sentence about a consequence,
          at the moment there is a consequence, beats three describing a feature
          before anyone has decided anything.
        */}
        <span className="min-w-0">
          <span className="block text-[13px] text-ink">{t('inspector.bashLabel')}</span>
        </span>
      </label>

      {/*
        ┌────────────────────────────────────────────────────────────────────┐
        │ ⚠ REWRITTEN 22/08 — THE OLD TEXT BOTH OVER-SCARED AND OVER-PROMISED.│
        │                                                                     │
        │ Old: *"can read and write anywhere on your machine"* + *"the only   │
        │ exception to the rule that artifacts stay inside the office"*.      │
        │                                                                     │
        │ Wrong at both ends:                                                 │
        │  · NOT the only exception for READING — `Read`/`Glob`/`Grep` have   │
        │    no fence either (types.ts §BUILTIN_TOOLS).                       │
        │  · "Write anywhere" is technically true and WRONG as a product      │
        │    statement: `outputScoper` always pulls output back into          │
        │    `artifacts/`, so a plan has never pointed `Bash` outward. The    │
        │    22/08 22:06 run tried it: 7 turns · $0.3158 · blocked, no file.  │
        │                                                                     │
        │ Over-scaring makes the user turn off something they need;           │
        │ over-promising makes them turn it on to buy something that does not │
        │ exist. The second is worse.                                         │
        │                                                                     │
        │ The new text keeps exactly ONE warning, and it is true: the command │
        │ runs with the user's own privileges. The "writing outward must go   │
        │ through an explicit tool/MCP" policy →                              │
        │ SPEC-tools-approval.md §1b, §8.                                     │
        └────────────────────────────────────────────────────────────────────┘
      */}
      {on && (
        <p className="mt-2.5 rounded bg-warn-soft px-2 py-1.5 text-xs leading-relaxed text-warn">
          {t('inspector.bashWarnBefore')} <b>{t('inspector.bashWarnBold')}</b>{' '}
          {t('inspector.bashWarnAfter')}
        </p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px] last:border-0">
      <span className="text-ink">{k}</span>
      <span className="text-right text-muted">{v}</span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="my-3 text-xs leading-relaxed text-muted">{children}</p>;
}

/**
 * THE ARMS AN EMPLOYEE HOLDS — shows LABELS, never HASHES.
 *
 * The previous version printed `node.mcp.join(', ')` directly, yielding
 * `a385afc3ab6, a4fbabd0360`. That is **the same bug** fixed in the work log on
 * 24/08, only somewhere else: a hash is an IDENTITY, not something to read. If the
 * user named it "Musics" then everywhere says "Musics" — and the inspector is an
 * everywhere.
 *
 * The label is looked up through the 🔌 node already on the diagram, so no new
 * data is needed. It falls back to the hash when the arm has vanished from
 * `company.yaml`: at that point the hash is the ONLY thing still true, and it
 * matches the "no longer declared in company.yaml" line on that node's own panel.
 *
 * The field used to be labelled *"External tool"* — a coder's vocabulary. The user
 * drags a wire from a node called **Connection**, so this field speaks the same
 * language.
 */
function ArmList({ ids, nodes }: { ids?: string[]; nodes: CanvasNode[] }) {
  if (!ids?.length) return null;
  const name = (id: string) => nodes.find((n) => n.kind === 'mcp' && n.server === id)?.label ?? id;
  return <Row k={t('inspector.armsInUse')} v={ids.map(name).join(', ')} />;
}

/**
 * AN ARM'S DIRECTORIES — read only, and "read only" here is a statement about
 * IDENTITY.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS NOT AN INPUT FIELD.                                           │
 * │                                                                           │
 * │ The label is editable because a label is not an identity. The directories │
 * │ are INSIDE the config, and identity = `armHash(config)` — so "edit the    │
 * │ directory" is not an edit, it is **a different arm**. Allowing an in-place│
 * │ edit rebuilds exactly the SILENT OVERWRITE case §6i exists to stop: the   │
 * │ node unchanged, every wire unchanged, only the directory underneath       │
 * │ different — **with no symptom where it happened**. The right path is      │
 * │ `+ Connection` for a new one and then withdrawing the old.                │
 * │                                                                           │
 * │ But it MUST be shown: this is what answers *"how far does this employee   │
 * │ reach"* — and today the only way to read it is opening `company.yaml`,    │
 * │ and an "open the yaml file" step is an alarm bell (§6, settled 22/08).    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Shown VERBATIM: no separator normalisation and no OS sniffing. This string
 * exists for the user to compare by eye against Explorer/Finder, so it has to be
 * what they typed — `D:\…` on Windows, `/home/…` on Linux/macOS, and an office
 * zipped over from a different platform still shows what was written.
 * `folderRoots` deliberately accepts both shapes everywhere, for the same reason
 * `SHELL_ALIASES` sends both tool names.
 *
 * Empty ⇒ draw NOTHING: a Notion/GitHub arm has no directories, and an empty field
 * lies that the config is incomplete.
 */
function ArmFolders({ folders }: { folders?: string[] }) {
  if (!folders?.length) return null;
  return (
    <div className="border-b border-line py-1.5 text-[13px] last:border-0">
      <div className="text-ink">{t('inspector.reachableFolders')}</div>
      <ul className="mt-1 space-y-0.5">
        {folders.map((f) => (
          // `break-all`: a Windows path mixes spaces and backslashes and has no
          // decent place to wrap. Better a break mid-word than a path running off
          // the side of the panel.
          <li key={f} className="select-all break-all font-mono text-xs text-muted">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * RENAME A CONNECTION — and it DELIBERATELY carries no warning.
 *
 * A label is not an identity (the identity is the config hash), so changing it
 * touches no key, rewrites no `roles/*.yaml`, and breaks nobody's cache. Pasting a
 * warning here teaches the user to skip warnings — and then they skip the one
 * worth reading, exactly why `renameAssistant` has none either.
 */
function ArmName({ node }: { node: CanvasNode }) {
  const [text, setText] = useState(node.label);
  useEffect(() => setText(node.label), [node.label]);
  const dirty = text.trim() !== node.label && text.trim().length > 0;

  return (
    <div className="mt-3">
      {/*
        ┌──────────────────────────────────────────────────────────────────────┐
        │ THE LEVEL BADGE — **DERIVED FROM `level`, NEVER READ OFF THE NAME**.  │
        │                                                                       │
        │ The user asked on 25/08 *"isn't putting the permission in the name a  │
        │ bit shaky?"* — it is. The label belongs to the user and changes freely│
        │ (§6i). Bake `· read only` into the string and one rename can produce  │
        │ **"Notion (writable)" on a read-only arm** — a label lying about      │
        │ PRIVILEGE, precisely the "empty promise" bug removed in exercise 11   │
        │ step 5.                                                               │
        │                                                                       │
        │ So: two layers. The outer one (the name) is editable; the inner one   │
        │ (the badge) is not — it reads `arms[hash].level`, which lives inside  │
        │ that very hash. The input right below **cannot** reach it, and that is│
        │ the whole point.                                                      │
        └──────────────────────────────────────────────────────────────────────┘
      */}
      {(node.level || node.via || node.optionLabels?.length) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {/*
            HOW IT RUNS — *"looking at the panel tells you how it is configured"*
            (user, 29/08).

            Derived from **the saved config** (`catalog.ts §activeOptions`), not
            from a separately stored list of ids: with two sources for one truth,
            the wrong one will be the DISPLAYED one — the user reads a config that
            is not the config running, and that is the hardest kind of lie to
            catch.
          */}
          {node.optionLabels?.map((t) => (
            <span key={t} className="rounded bg-line/70 px-1.5 py-0.5 text-[11px] text-muted">
              {t}
            </span>
          ))}
          {/* WHICH workspace — user, 26/08. Resolved from the key name, never read off the label. */}
          {node.via && (
            <span className="rounded bg-line/70 px-1.5 py-0.5 text-[11px] text-muted">{node.via}</span>
          )}
          {node.level && (
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                node.level === 'full' ? 'bg-danger-soft text-danger' : 'bg-line/70 text-muted'
              }`}
            >
              {node.level === 'read'
                ? t('inspector.level.read')
                : node.level === 'add'
                  ? t('inspector.level.add')
                  : t('inspector.level.full')}
            </span>
          )}
          {node.toolCount ? (
            <span className="text-[11px] tabular-nums text-muted">
              {plural('inspector.toolCount', node.toolCount)}
            </span>
          ) : null}
        </div>
      )}
      {/*
        ⚠ ON ITS OWN, NOT IN THE CHIP ROW. (the user's call, 29/08)

        A chip is **state** — something to read. This button is an **action**, and
        the only action in this panel that opens a window outside agentco. Mix the
        two kinds into one row and the eye skims past it like a label.
      */}
      {node.canLogin && <BrowserLogin />}
      <label className="text-[11px] uppercase tracking-wide text-muted">
        {t('inspector.displayName')}
      </label>
      <div className="mt-1 flex gap-1.5">
        <Input value={text} onChange={(e) => setText(e.target.value)} />
        <Button
          disabled={!dirty}
          onClick={() => void actions.renameArm(node.server!, text.trim())}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/** The inspector on the right. Opens when a node is selected; ✕ closes it. */
export function Inspector({ onShowPrompt }: { onShowPrompt(who: string): void }) {
  const canvas = useApp((s) => s.canvas);
  const selected = useApp((s) => s.selected);
  const [confirmRemove, setConfirmRemove] = useState<CanvasNode | null>(null);

  const node = canvas?.nodes.find((n) => n.id === selected);
  if (!canvas || !node) return null;

  /**
   * A STORE node never gets an inspector.
   *
   * This panel is for EDITING an object. The knowledge store and the library have
   * nothing to edit — they are doors onto a drawer, and clicking them opens that
   * drawer directly (see `onOpenStore` in Canvas.tsx).
   *
   * The guard lives HERE rather than at the call site because it closes the whole
   * CLASS of bug: the previous version had no render branch for the library, so
   * clicking it opened an empty panel with nothing but a ✕ — and every store node
   * added later would repeat that exactly if someone forgot to write a branch.
   * Now forgetting is harmless.
   */
  if (node.kind === 'knowledge' || node.kind === 'library') return null;

  const onDuty = canvas.nodes.filter((n) => n.kind === 'agent' && n.connected);
  const off = canvas.nodes.filter((n) => n.kind === 'agent' && !n.connected);

  function toggleDuty(n: CanvasNode) {
    const edges = n.connected
      ? canvas!.edges.filter((e) => !(e.from === 'assistant' && e.to === n.id))
      : [...canvas!.edges, { from: 'assistant', to: n.id }];
    void actions.saveCanvas(canvas!.nodes, edges);
  }

  return (
    <aside className="flex w-[304px] flex-none flex-col border-l border-line bg-panel">
      <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="truncate text-[15px] font-semibold">
          {node.avatar ? `${node.avatar} ` : ''}
          {node.label}
        </span>
        <div className="flex-1" />
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={t('common.close')}
          onClick={() => actions.select(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {node.kind === 'assistant' && (
          <>
            <AssistantName node={node} />
            <ModelPicker node={node} />
            <Row k={t('inspector.onDuty')} v={plural('inspector.peopleCount', onDuty.length)} />
            <Row k={t('inspector.offDuty')} v={plural('inspector.peopleCount', off.length)} />
            <Row
              k={t('inspector.ownNotebook')}
              v={plural('knowledge.noteCount', node.count ?? 0)}
            />
            <ArmList ids={node.mcp} nodes={canvas.nodes} />
            <CharacterPicker node={node} />
            <Note>
              {t('inspector.rosterNoteBefore')} <b>{t('inspector.rosterNoteBold')}</b>{' '}
              {t('inspector.rosterNoteAfter')}
            </Note>
            <Button className="w-full" onClick={() => onShowPrompt('assistant')}>
              <FileCode2 className="h-4 w-4" />
              {t('inspector.viewPrompt')}
            </Button>
          </>
        )}

        {/*
          The `knowledge` branch was REMOVED (17/08). Its two explanations were not
          lost — they moved into the Knowledge drawer itself, where they belonged
          all along: they are facts about THE STORE, not about the node on the
          diagram.
        */}

        {node.kind === 'mcp' && (
          <>
            <Row k={t('inspector.type')} v="MCP server" />
            <Row
              k={t('inspector.inUseBy')}
              v={
                canvas.edges
                  .filter((e) => e.from === node.id)
                  .map((e) => canvas.nodes.find((n) => n.id === e.to)?.label ?? e.to)
                  .join(', ') || t('inspector.nobody')
              }
            />
            <ArmFolders folders={node.folders} />
            {/*
              The red border on the diagram gets its sentence HERE — the node
              has room for four words, this panel is where someone comes to
              find out what to do about it. Naming the account matters: an arm
              can hold a credential whose label looks nothing like the arm's
              own name, and *"sign in again"* is unanswerable without knowing
              sign in as WHOM. → `office.ts §keyDeadOf`
            */}
            {node.keyDead && !node.missing && (
              <Note>
                <span className="text-danger">
                  {t('inspector.armKeyDead', { who: node.keyDead })}
                </span>
              </Note>
            )}
            {node.missing && (
              <Note>
                <span className="text-danger">{t('inspector.missingArm')}</span>
              </Note>
            )}
            {/*
              REMOVED: *"wiring it to an employee = writing `mcp:` into
              `roles/<id>.yaml`"*.

              That describes **how we store it**, not what the user does — they
              drag a wire, and the yaml file is our business. Same rule as the two
              blocks below: a line only earns its place if it changes what the user
              is about to do.
            */}

            {/*
              TWO STEPS, exactly as an employee has "Send home" and "Archive" — the
              line between them is *can it be rebuilt*:

                Remove from office  cuts every wire HERE. The config and the key
                                    stay intact at company level, so it comes back
                                    through "already plugged in elsewhere" under
                                    `+ Connection`.
                Delete for good     drops it from company.yaml. ⚠ THE KEY IS KEPT —
                                    pulling a wire ≠ throwing away a key: people
                                    unplug to rotate tokens, and making them fetch
                                    it again punishes a harmless action.
            */}
            <ArmName node={node} />

            {/*
              ONE STEP, NOT TWO. (the user's call, 23/08)

              An employee gets "Archive" and "Delete for good" because they carry
              things that CANNOT be rebuilt — skills, a pitch, a notebook of
              lessons. An arm carries only config, and that config lives in the
              SHARED LEDGER, which nobody deletes. So "delete" here already has the
              character of "archive": plug in the same directory ⇒ the same hash ⇒
              found intact, with nothing to re-enter.

              Borrowing a concept from where it is earned into a place where it is
              not, is exactly what was just removed. → SPEC-arms.md §6i
            */}
            {/*
              ┌──────────────────────────────────────────────────────────────────┐
              │ TWO `Note` BLOCKS REMOVED. (user, 26/08: *"prune this block for  │
              │ me, and I don't mind pruning them everywhere"*)                  │
              │                                                                  │
              │ ① *"The config and the key are kept…"* — it repeats the          │
              │   confirmation dialog word for word, and that appears **exactly  │
              │   when the user needs it**. Saying something in advance that will│
              │   be said again makes them read it twice.                        │
              │                                                                  │
              │ ② *"Wiring it to the assistant = odd jobs… concierge (M1)…       │
              │   breaks the prompt cache"* — that is a note for **whoever writes│
              │   the code**, not for the user: `concierge`, `M1` and `prompt    │
              │   cache` are all our vocabulary.                                 │
              │                                                                  │
              │ ⚠ The rule this yields, applying to every `Note` from now on: a  │
              │ line only earns its place if it **changes what the user is about │
              │ to do**. Text that is true but changes nothing teaches people to │
              │ skim past all the other text — and then they skim past the one   │
              │ worth reading. The same argument used for NOT pasting a warning  │
              │ onto the rename button (§AssistantName).                         │
              └──────────────────────────────────────────────────────────────────┘
            */}
            <ArmLog server={node.server!} />

            <Button variant="danger" className="mt-4 w-full" onClick={() => setConfirmRemove(node)}>
              {t('inspector.removeFromOffice')}
            </Button>
          </>
        )}

        {node.kind === 'agent' && (
          <>
            <AgentProfile node={node} />
            <ModelPicker node={node} />
            <Row k={t('inspector.roleId')} v={node.role} />
            <Row
              k={t('inspector.ownNotebook')}
              v={plural('knowledge.noteCount', node.count ?? 0)}
            />
            <Row
              k={t('inspector.status')}
              v={node.connected ? t('inspector.statusOnDuty') : t('inspector.statusOffDuty')}
            />
            <ArmList ids={node.mcp} nodes={canvas.nodes} />
            <CharacterPicker node={node} />
            {node.missing && (
              <Note>
                <span className="text-danger">
                  {t('inspector.missingRole', { role: node.role ?? '' })}
                </span>
              </Note>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <Button onClick={() => onShowPrompt(node.role!)}>
                <FileCode2 className="h-4 w-4" />
                {t('inspector.viewPrompt')}
              </Button>
              <Button onClick={() => toggleDuty(node)}>
                {node.connected ? t('inspector.rest') : t('inspector.backOnDuty')}
              </Button>
              {/* "Send home" = still on the diagram, only the wire is gone →
                  temporary. "Archive" = off the diagram, the file intact →
                  long-term. Two genuinely different steps, so two buttons rather
                  than one button that asks. */}
              <Button onClick={() => void actions.archiveAgent(node.role!, true)}>
                <Archive className="h-4 w-4" />
                {t('inspector.archive')}
              </Button>
              <Button variant="danger" onClick={() => setConfirmRemove(node)}>
                <Trash2 className="h-4 w-4" />
                {t('inspector.deleteForGood')}
              </Button>
            </div>

            <Note>{t('inspector.builtinNote')}</Note>
            <BashSwitch node={node} />
          </>
        )}
      </div>

      <SectionTitle className="flex-none border-t border-line px-4 py-2">{node.kind}</SectionTitle>

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmRemove?.kind === 'mcp'
                ? t('inspector.confirmRemoveArmTitle', { label: confirmRemove.label })
                : t('inspector.confirmDeleteAgentTitle', { label: confirmRemove?.label ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {confirmRemove?.kind === 'mcp' ? (
                <>
                  {t('inspector.armRemoveBody1')} <b>{t('inspector.armRemoveBold')}</b>{' '}
                  {t('inspector.armRemoveBody2')}
                  <br />
                  <br />
                  {/* No scare wording, because there is nothing to be scared of:
                      the shared ledger keeps the config and the key, so this is
                      REVERSIBLE. Stating its true weight is how the warnings that
                      ARE real keep theirs. */}
                  {t('inspector.armRemoveKeep1')} <b>{t('inspector.armRemoveKeepBold')}</b>
                  {t('inspector.armRemoveKeep2')}
                </>
              ) : (
                <>
                  {/* ⚠ THE `roles/<id>.yaml` LINE IS GONE, AND SO IS THE "no getting
                      it back". → SPEC-office-animation.md §17i. The path is our
                      filing detail; what the user is deciding is *delete this
                      person*. The paragraph that stays is the one that carries a
                      real surprise — the lessons under `knowledge/agents/` — and
                      it keeps its weight only because the one beside it stopped
                      shouting about a file nobody named. */}
                  {t('inspector.agentNotesBefore')}{' '}
                  <code>knowledge/agents/{confirmRemove?.role}/</code>{' '}
                  {t('inspector.agentNotesAfter')}
                  <br />
                  <br />
                  {t('inspector.archiveHintBefore')} <b>{t('common.cancel')}</b>{' '}
                  {t('inspector.archiveHintMid')} <b>{t('inspector.archive')}</b>{' '}
                  {t('inspector.archiveHintAfter')}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRemove(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmRemove?.kind === 'mcp' && confirmRemove.server) {
                  void actions.removeArm(confirmRemove.server);
                } else if (confirmRemove?.role) {
                  void actions.removeAgent(confirmRemove.role);
                }
                setConfirmRemove(null);
              }}
            >
              {confirmRemove?.kind === 'mcp'
                ? t('inspector.removeFromOfficeShort')
                : t('inspector.deleteForGood')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
