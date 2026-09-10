/**
 * PLUGGING IN AN ARM — a three-step dialog. → docs/SPEC-arms.md §6e–§6h
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THREE STEPS, AND WHY STEP 3 IS MANDATORY                              │
 * │                                                                           │
 * │   1. Pick       the catalogue cards are ON the first screen — that is     │
 * │                 the whole meaning of "pull it out and use it". No drag    │
 * │                 and drop: the canvas auto-arranges and has a "Rearrange"  │
 * │                 button, so dragging PROMISES a control the button beside  │
 * │                 it takes back. → §6e                                      │
 * │   2. Keys+Test  Save stays closed until Test has succeeded once. A        │
 * │                 non-coder does not need to understand MCP — they need to  │
 * │                 see a ✓.                                                  │
 * │   3. Grant      MANDATORY. An unwired node is a DEAD NODE: it sits on the │
 * │                 diagram looking finished and nobody can use it — and a    │
 * │                 user who just pressed Save and saw a ✓ will NOT guess     │
 * │                 there is still a wire to drag. Exactly the "the system    │
 * │                 lies about its own state" class of bug.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, FolderOpen, Loader2, Trash2, TriangleAlert, X } from 'lucide-react';

import { ArmIcon } from '@/components/ArmIcon';
/**
 * PER-VENDOR BLOCKS — one file each, in `components/arm/`.
 * (the user's call, 28/08: *"there is a fair amount of custom work to match each
 * provider… reorganise it"*)
 *
 * These four only appear when a catalogue entry **declares** the matching field
 * (`deviceLogin`, `scope`, `repoScan`) — i.e. THE DATA decides, not a branch on
 * the vendor's name. Split out so that fixing GitHub next time means opening
 * exactly one file, and so the dialog stops being both the coordinator and the
 * place everything is drawn.
 */
import { DeviceCode } from '@/components/arm/DeviceCode';
import { OwnClient } from '@/components/arm/OwnClient';
import { RepoScan } from '@/components/arm/RepoScan';
import { ScopeBox } from '@/components/arm/ScopeBox';
import type { DeviceLogin, RepoScanState } from '@/components/arm/types';

import { Button } from '@/components/ui/button';
import { ConfirmDelete } from '@/components/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/misc';
import { api, ApiError } from '@/lib/api';
import {
  alignExample,
  blankAct,
  cliCount,
  cliDecl,
  cliProblems,
  declToDraft,
  draftToDecl,
  dupIds,
  isCliPaste,
  safeJson,
  sampleAct,
  slots,
  slugId,
  toArgv,
  type CliDraft,
} from '@/lib/cli-form';
import { fault, pretty, tokens } from '@/lib/json-paint';
import { actions, useApp } from '@/lib/store';
import { plural, t, type MessageKey } from '@i18n';
import { formatNumber } from '@i18n/fmt';
import type { CatalogArm, InstalledArm, OAuthAccount, ProbeResult } from '@/lib/types';

/**
 * The sub-line states THE PRICE — people choose by the effort it costs them, not
 * by the vendor's name.
 *
 * Keys, resolved at render: a module-level string would freeze whichever
 * language the page happened to load with.
 */
const PRICE_SAY: Record<CatalogArm['price'], MessageKey> = {
  none: 'arm.price.none',
  keys: 'arm.price.keys',
  login: 'arm.price.login',
};

/**
 * Three access levels, stated as CONSEQUENCES rather than in MCP vocabulary.
 *
 * The user does not know what `destructiveHint` is, and does not need to. What
 * they have to decide is *"can this employee change what I wrote"*. → §6j
 */
/**
 * The SHORT form of `TIER_SAY.name` — for badges in a cramped list.
 *
 * Shared with `Inspector` and `OverviewPanel` through the catalogue: the same
 * three words used to be spelled out in all three files, so adding a level meant
 * finding three places. → `inspector.level.*`
 */
const LEVEL_SAY: Record<'read' | 'add' | 'full', MessageKey> = {
  read: 'inspector.level.read',
  add: 'inspector.level.add',
  full: 'inspector.level.full',
};

const TIER_SAY: Record<'read' | 'add' | 'full', { name: MessageKey; help: MessageKey }> = {
  read: { name: 'arm.tier.read.name', help: 'arm.tier.read.help' },
  add: { name: 'arm.tier.add.name', help: 'arm.tier.add.help' },
  full: { name: 'arm.tier.full.name', help: 'arm.tier.full.help' },
};

/** Step 1's KIND card. The sub-line says what to do next, not what it is technically. */
function TypeCard({
  icon,
  name,
  say,
  onClick,
}: {
  /** A drawn mark, NOT an emoji: the same set as every later step. → `ArmIcon.tsx` */
  icon: ReactNode;
  name: string;
  say: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-line px-3 py-4 text-left transition hover:border-accent hover:bg-accent-soft"
    >
      <div className="text-muted">{icon}</div>
      <div className="mt-1.5 text-[13px] font-medium">{name}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted">{say}</div>
    </button>
  );
}

/*
  `nextFreeId` was REMOVED (23/08). It existed to dodge id collisions back when
  the id was chosen by the user — now the id is a HASH of the config, so "collides"
  means "is exactly the same thing", and the answer is no longer a different name
  but REUSE. → SPEC-arms.md §6i
*/

/** The directory the user left last time — the picker reopens THERE, not at the drive root. */
const LAST_DIR = 'agentco.lastBrowseDir';

/**
 * THE SHARED WIDTH of both dialogs in this file. (user, 01/09: the folder picker
 * is *"a bit long"* — it was 64rem while the dialog that opens it is only 46rem.)
 *
 * ⚠ ONE constant, not two identical strings: the picker opens **from inside** the
 * arm dialog, so if one is wider than the other the whole frame jumps out and back
 * on every open. The real constraint here is not "46rem" — it is *"the picker is
 * never wider than the dialog that opened it"*, and the only way to hold a
 * constraint between two values is to not have two values.
 * [[agentco-count-mechanisms]]
 */
const DIALOG_W = 'w-[min(46rem,94vw)]';

/** Compared the way the server does: drop the trailing slash, normalise to `/`, casefold. */
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Is this directory already some arm of THIS office? Returns its name.
 *
 * The client-side twin of `catalog.ts §coveredBy`. ⚠ It does NOT replace the
 * server's guard — a client can skip it, so the real rule stays on the server. It
 * only moves the answer from the last step to the first.
 */
function clashingArm(folder: string, installed: InstalledArm[], officeId: string | null): string | undefined {
  const want = normPath(folder);
  for (const a of installed) {
    if (!a.usedBy.some((u) => u.office === officeId)) continue;
    const args = (a.config as { args?: unknown })?.args;
    if (!Array.isArray(args)) continue;
    if (args.some((x) => typeof x === 'string' && normPath(x) === want)) return a.id;
  }
  return undefined;
}

/**
 * The "already plugged in elsewhere" list: filter, then **IN USE ON TOP, ORPHANS
 * AT THE BOTTOM**. (the user's call, 25/08)
 *
 * > *"leaving it up top steals the attention space"*
 *
 * That is the right reading of this list: it is a place to **reuse**, not a place
 * to tidy. An entry nobody uses is only present so it can still be deleted —
 * scattered through the middle it makes the user filter by eye on every plug-in.
 *
 * ⚠ Sorted by TWO keys. Without the second, two entries in the same group swap
 * places between two openings of the dialog: `listArms` follows the key order in
 * the yaml, and nothing guarantees that order — and a list that reshuffles itself
 * is what makes people click the wrong row.
 *
 * ⚠ ONE function, two call sites (on open, and after a delete-for-good). Sorting
 * in one and forgetting the other is a list that re-sorts under the hand that just
 * clicked.
 *
 * ⚠ This is only the BASE order. What the user actually sees is settled by
 * `byKind` at render, because that needs `catalog` — which has not arrived when
 * this function runs.
 */
function forList(arms: InstalledArm[], officeId: string | null): InstalledArm[] {
  return arms
    .filter((a) => !a.usedBy.some((u) => u.office === officeId))
    .sort((a, b) => Number(a.orphan) - Number(b.orphan) || a.label.localeCompare(b.label, 'vi'));
}

/**
 * THREE KINDS, and a plugged-in arm belongs to exactly one. → §6e
 *
 * Derived from `catalog`, not from the config's shape: a catalogue entry with
 * `folders` IS a file arm, even if we move it to HTTP tomorrow. No `catalog` ⇒ the
 * user pasted it themselves ⇒ `custom`.
 */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE JSON PASTE BOX — colour, reformat, and POINT AT THE BREAK. (user      │
 * │ 31/08)                                                                    │
 * │                                                                           │
 * │ Three jobs, and only the third can report an error:                       │
 * │  ① colour   field names ≠ values. Neutral, not a funfair — these users    │
 * │             work in an office, they are not developers reading code all   │
 * │             day.                                                          │
 * │  ② reformat line breaks + 2-space indent. **ONLY when the JSON is         │
 * │             valid** — with no tree there is nothing to reformat, and      │
 * │             "helpfully" rewriting a broken block is the surest way to     │
 * │             lose the place they were working in.                          │
 * │  ③ errors   `JSON.parse` throws with a **position** ⇒ line/column plus a  │
 * │             human sentence. This is the part that points at the break;    │
 * │             colour does not.                                              │
 * │                                                                           │
 * │ ⚠ WHEN TO REFORMAT: on **paste** and on **blur**, NOT on every keystroke  │
 * │ — reformatting mid-typing moves the caret and the user loses their place. │
 * │                                                                           │
 * │ ⚠ WHY THERE IS A `<pre>` UNDERNEATH: a `<textarea>` cannot colour         │
 * │ individual characters — that is a limitation of the element, not a        │
 * │ choice. So the real text is transparent, the coloured layer sits under    │
 * │ it, and the two must share **the same font, size, padding and             │
 * │ `white-space`** and scroll together. One property out of step and the     │
 * │ text separates from its colour.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const TOK: Record<string, string> = {
  // Teal = names, brown = values. Theme tokens, NOT hard-coded colour codes — see
  // the note at `index.css §--color-jkey`.
  key: 'text-jkey',
  str: 'text-jval',
  num: 'text-jval',
  lit: 'text-jval',
  punc: 'text-muted',
  ws: '',
};

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 ONE CLASS STRING, TWO ELEMENTS — bug reported 01/09: *"the textarea   │
 * │ and its overlay break, the text spills outside the box"*.                │
 * │                                                                          │
 * │ The coloured box is **two exactly-aligned layers**: a `<pre>` painting   │
 * │ the colour, a transparent `<textarea>` on top. They align only while     │
 * │ **everything that decides where a line wraps** is identical: font · size │
 * │ · leading · padding · border · radius · and **the text area's width**.   │
 * │ The previous version typed two sets of classes by hand ⇒ they disagreed  │
 * │ in three places (`rounded-md` vs `rounded-lg`, `Textarea`'s `text-sm`    │
 * │ overridden by another class, and neither side reserving scrollbar room). │
 * │                                                                          │
 * │ ⭐ The main culprit is the last one: once the text is long enough, **the │
 * │ textarea grows a scrollbar** ⇒ its text area narrows by ~15px while the  │
 * │ `<pre>` does not ⇒ the two layers wrap in different places, and the      │
 * │ offset **accumulates line by line**. That is what reads as "text spilling│
 * │ out of the box". `scrollbar-gutter: stable` reserves the room on BOTH,   │
 * │ so the width does not change whether it scrolls or not.                  │
 * │                                                                          │
 * │ ⇒ One constant for the shared part. Two hand-typed copies of one truth   │
 * │ drift sooner or later — here "sooner or later" was the first time anyone │
 * │ pasted a long JSON block. [[agentco-count-mechanisms]]                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * 🔴 ROUND TWO (01/09) — the first fix was NOT enough, and the reason is worth
 * more than the fix.
 *
 * The first version gave each layer its own `scrollbar-gutter: stable` and trusted
 * the two widths to match. They do **not**: the `<textarea>` is `overflow-y: auto`
 * (a real scroll container, so it gets a gutter) while the `<pre>` is
 * `overflow: hidden` — the browser reserves **no gutter** for it. ~15px apart, and
 * the offset accumulates per line ⇒ exactly the symptom the user described: *"the
 * one you actually edit is a bit shorter"*.
 *
 * ⇒ **Drop the width race instead of synchronising it: ONE scrollbar, on the
 * SHARED FRAME.** The textarea grows to its content (`overflow: hidden`), the
 * `<pre>` grows to its content, and both sit inside a single scrolling frame. The
 * two widths are equal **by construction**, not by two declarations agreeing.
 *
 * 🎁 And it **deletes a mechanism**: no more `onScroll` syncing `scrollTop` — the
 * layers scroll together because they are in the same frame. A synchronisation
 * mechanism deleted is a place that can no longer drift.
 * [[agentco-count-mechanisms]]
 *
 * ⚠ The `<pre>` uses `top-0 inset-x-0`, NOT `inset-0`: `bottom-0` would force its
 * height to the scroll frame's **visible** part, cutting off longer content.
 */
const JSON_TEXT = 'font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words px-3 py-2';

/**
 * ONE FORM ROW: **label on the left, input on the right**. (the user's call, 01/09)
 *
 * ⚠ `items-start` + `pt-2`, not `items-center`: the right-hand side may be a
 * two-line `Textarea` or drag a row of argv chips along with it, and centring
 * floats the label into the middle of the block — the eye loses the vertical scan
 * line, which is the only thing that makes a two-column layout worth more than a
 * label on top.
 *
 * ⚠ The label column has a **fixed width**, not `auto`: `auto` gives each row a
 * width set by its own text, and then there are no longer two columns.
 */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  /** The line under the label — where the *why* goes, so the label can stay one word. */
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 grid grid-cols-[150px_1fr] gap-3">
      <div className="pt-2">
        <Label htmlFor={htmlFor} className="mb-0 text-ink">
          {label}
        </Label>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE SYNTAX HAS NO SLOT YET — compare it with the Example line to **POINT  │
 * │ AT** where one belongs.                                                   │
 * │                                                                           │
 * │ This is where the Example field answers a question no other screen can:   │
 * │ *"which part of this command line changes each time?"* The user knows the │
 * │ answer — they just ran it twice with two values — but they **do not know  │
 * │ that we need to know**. Making them invent the concept "parameter" and    │
 * │ type `{…}` themselves is making them learn the machine's vocabulary;      │
 * │ comparing two real command lines is not.                                  │
 * │                                                                           │
 * │ ⚠ It POINTS, it does not edit. Substituting `{…}` into the syntax for     │
 * │ them changes what the user just typed, and this is a GUESS — the same     │
 * │ rule as `toArgv`: guessing is allowed, but the user has to be the one who │
 * │ clicks.                                                                   │
 * │                                                                           │
 * │ ⚠ And it stays quiet when the two lines are identical: a fixed command is │
 * │ perfectly normal, not an omission worth mentioning.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function ExampleNoSlot({ line, example }: { line: string; example: string }) {
  if (!example.trim() || !line.trim()) return null;
  const a = toArgv(line);
  const b = toArgv(example);
  if (a.length !== b.length) {
    return (
      <p className="mt-1 text-[11px] text-muted">
        {t('arm.exPartsMismatch', { a: a.length, b: b.length })}
      </p>
    );
  }
  const at = a.map((_, i) => i).filter((i) => a[i] !== b[i]);
  if (!at.length) return null;
  if (at.length > 1) {
    return (
      <p className="mt-1 text-[11px] text-muted">
        {t('arm.exManyDiffsBefore', { n: at.length })}{' '}
        <code className="rounded bg-accent-soft px-1">{'{slot_name}'}</code>{' '}
        {t('arm.exManyDiffsAfter')}
      </p>
    );
  }
  const i = at[0]!;
  return (
    <p className="mt-1 text-[11px] text-muted">
      {t('arm.exOneDiff1')} <code className="rounded bg-accent-soft px-1">{a[i]}</code> →{' '}
      <code className="rounded bg-accent-soft px-1">{b[i]}</code>
      {t('arm.exOneDiff2')} <code className="rounded bg-accent-soft px-1">{'{slot_name}'}</code>{' '}
      {t('arm.exOneDiff3')}
    </p>
  );
}

function JsonBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const back = useRef<HTMLPreElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const bad = fault(value);
  const toks = tokens(value);

  /**
   * The textarea is exactly as tall as its content — it must NOT scroll itself,
   * because the outer frame is what scrolls. Set `auto` before reading
   * `scrollHeight`, otherwise it only ever grows and never shrinks back when the
   * user deletes lines.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const tidy = (): void => {
    const out = pretty(value);
    if (out !== null) onChange(out);
  };

  return (
    <div>
      <div className="relative max-h-64 overflow-y-auto rounded-lg border border-line bg-paper focus-within:border-accent">
        <pre
          ref={back}
          aria-hidden
          className={`${JSON_TEXT} pointer-events-none absolute inset-x-0 top-0 m-0`}
        >
          {toks.map((t, i) => (
            <span key={i} className={TOK[t.t]}>
              {t.v}
            </span>
          ))}
          {'\n'}
        </pre>
        <Textarea
          ref={box}
          rows={1}
          autoFocus
          spellCheck={false}
          /**
           * 🔴 `caret-ink`, NOT `caret-fg`. (bug caught 31/08: *"clicking in to
           * edit, there is no blinking cursor"*)
           *
           * This theme declares `--color-ink`, so the `caret-fg` utility **does
           * not exist** — the class was dropped silently, `caret-color` was never
           * set, and it inherited the box's own `color`, which here is
           * `transparent` (the real text must be transparent for the coloured
           * layer beneath to show). ⇒ **A transparent caret.** A misspelt Tailwind
           * class reports nothing anywhere; it quietly does not exist.
           */
          className={`${JSON_TEXT} relative block w-full resize-none overflow-hidden rounded-none border-0 bg-transparent text-transparent caret-ink focus:border-0`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={tidy}
          onPaste={() => {
            // After the browser has written the text into the box.
            // `requestAnimationFrame` rather than `setTimeout(0)`: it runs after
            // the paint, so it does not race React.
            requestAnimationFrame(() => requestAnimationFrame(tidy));
          }}
          placeholder={t('arm.jsonPlaceholder')}
        />
      </div>
      {bad && value.trim() !== '' && (
        <p className="mt-1 text-xs text-danger">
          {bad.line > 0 ? t('arm.jsonAt', { line: bad.line, col: bad.col }) : ''}
          {bad.say}
        </p>
      )}
    </div>
  );
}


type Kind = 'files' | 'service' | 'custom' | 'browser' | 'cli';

/**
 * ⚠ `cli` IS ITS OWN KIND, not a flavour of `custom`. (user, 01/09)
 *
 * > *"Drop all the custom-MCP suggestions in CLI, suggest only CLI, because these
 * > have now split into two different schools"*
 *
 * Right, and it is the forced consequence of splitting the tabs: once step 1 has
 * two cards, the "reuse" list has to split along the same line — otherwise the
 * Commands tab suggests an HTTP arm that the same tab **refuses to accept** when
 * pasted.
 *
 * ⚠ Asked as `type === 'cli'` on **the config itself** — the same question
 * `core/cli-arm.ts §isCliArm` and `isCliPaste` ask, not a third rule. And asked
 * **before** `a.catalog`: a CLI declaration never has a catalogue entry, so the
 * order does not change the answer — it only lets the CLI branch read as one line.
 */
function kindOf(a: InstalledArm, catalog: CatalogArm[]): Kind {
  if ((a.config as { type?: unknown })?.type === 'cli') return 'cli';
  if (!a.catalog) return 'custom';
  const entry = catalog.find((c) => c.id === a.catalog);
  return entry?.shape === 'browser' ? 'browser' : entry?.folders ? 'files' : 'service';
}

/**
 * An entry's vendor logo — from THE CATALOGUE, never from a table in the web
 * directory.
 *
 * Empty is normal (no logo for that vendor yet, or the entry has no vendor):
 * `ArmIcon` falls back to the mark for its kind. → `catalog.ts §brand.mark` · §11c
 */
function markOf(catalogId: string | undefined, catalog: CatalogArm[]): string | undefined {
  return catalogId ? catalog.find((c) => c.id === catalogId)?.brand.mark : undefined;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ORDER IN THE REUSE LIST: **orphan → KIND → name**. (user, 27/08)         │
 * │                                                                          │
 * │ > *"trashed (unused) and not-trashed should be ordered too — don't leave │
 * │ >  it messy. sort by type: provider → file → custom"*                    │
 * │                                                                          │
 * │ Key 1 keeps the earlier rule (in use on top, orphans at the bottom —     │
 * │ 25/08). Key 2 is the new part: WITHIN each group, cluster by kind. Key 3 │
 * │ (name) has to stay, because `listArms` follows the key order in the yaml │
 * │ — without it two entries of the same kind swap places between openings,  │
 * │ and a list that reshuffles itself is what makes people click wrong.      │
 * │                                                                          │
 * │ ⚠ SORT AT RENDER, not at load. `catalog` and `arms` arrive on TWO        │
 * │ parallel requests, so sorting right after `api.arms()` sorts against an  │
 * │ empty catalogue ⇒ `kindOf` returns `custom` for everything ⇒ exactly the │
 * │ mess being fixed, and it would NEVER re-sort itself. Re-rendering is     │
 * │ cheap; being wrong once and then standing still cannot be repaired.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const KIND_ORDER: Record<Kind, number> = { service: 0, browser: 1, files: 2, cli: 3, custom: 4 };

function byKind(arms: InstalledArm[], catalog: CatalogArm[]): InstalledArm[] {
  return [...arms].sort(
    (a, b) =>
      Number(a.orphan) - Number(b.orphan) ||
      KIND_ORDER[kindOf(a, catalog)] - KIND_ORDER[kindOf(b, catalog)] ||
      a.label.localeCompare(b.label, 'vi'),
  );
}

export function ArmDialog({ open, onOpenChange }: { open: boolean; onOpenChange(v: boolean): void }) {
  const officeId = useApp((s) => s.officeId);
  const canvas = useApp((s) => s.canvas);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  /** Step 1 has four faces: pick a KIND → folder / service / paste a config. */
  const [pane, setPane] = useState<'type' | 'files' | 'catalog' | 'paste' | 'cli'>('type');
  /**
   * The **Commands** tab — composing a CLI declaration through a form.
   * → SPEC-arms §16
   *
   * ⚠ It adds NO new save path: the form produces **exactly the JSON string** the
   * paste path already used, then continues through `paste` + step 2. A second
   * save path is where two screens eventually save two different things.
   */
  const [acts, setActs] = useState<CliDraft[]>([blankAct()]);
  /** View/edit as JSON. Two-way — the form is the source; pasted JSON is read back. */
  const [cliJson, setCliJson] = useState<string | null>(null);
  /**
   * The SHARED directory for the whole CLI arm — see `cli-form.ts §draftToDecl`.
   * `''` = the office directory.
   */
  const [cliCwd, setCliCwd] = useState('');
  /**
   * Has the directory screen been passed. Its own state rather than inferring
   * `cliCwd !== ''`: **"use the office directory"** is a valid answer and it leaves
   * `cliCwd` empty — inferred, whoever presses that button is thrown back to the
   * screen they just answered.
   */
  const [cliReady, setCliReady] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  /**
   * The declaration currently shown on the JSON tab, read back. `null` = not
   * viewing JSON, or the JSON is broken. Used for TWO things: locking "← Back to
   * form" when `mixed`, and **naming the right directory** in the top bar.
   */
  const cliBack = cliJson === null ? null : declToDraft(safeJson(cliJson));
  const cliMixed = cliBack?.mixed === true;
  /**
   * 🔴 THE TOP BAR'S DIRECTORY MUST BE READ FROM WHAT IS BEING EDITED. (bug caught
   * 01/09)
   *
   * In JSON mode `cliDecl` takes **the JSON block**, not `cliCwd` — so drawing
   * `cliCwd` in the top bar shows a value that **does nothing**, and worse, the
   * "Change…" button beside it edits that very inert value. That is the interface
   * lying about its own state — the same class of bug just fixed elsewhere.
   */
  const shownCwd = cliJson === null ? cliCwd : (cliBack?.cwd ?? '');
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE CONDITION TO PROCEED — ONE computation, driving **both** the button's│
   * │ lit/dim state and the red lines. (user, 01/09: *"it has to check the form│
   * │ and only continue when every command is valid"*)                         │
   * │                                                                          │
   * │ Dimming by one computation while the red lines follow another is the "the│
   * │ button is dim and nothing is red" case — the user has to hunt field by   │
   * │ field to guess why.                                                      │
   * │                                                                          │
   * │ ⚠ In JSON mode the rows to inspect are **the commands read back out of   │
   * │ the JSON block**, not `acts`: the block is what will be saved. Inspecting│
   * │ `acts` there inspects a draft nobody is saving.                          │
   * │                                                                          │
   * │ ⚠ Duplicate ids are the **first of two fences**. The real one is in      │
   * │ `server.ts §resolveArm → parseCliArm` — the SHARED door behind both Test │
   * │ and Done, so a stale tab, a race or a hand-written client still cannot   │
   * │ get past. This one exists to be **seen before the click**, not to hold   │
   * │ the rule.                                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const cliOut = pane === 'cli' ? cliDecl(acts, cliCwd, cliJson) : null;
  const cliRows = cliJson === null ? acts : (cliBack?.acts ?? []);
  const cliBad = pane === 'cli' ? cliProblems(cliRows, t) : [];
  const badIds = dupIds(cliOut);
  /** `cliOut === null` = the JSON block is broken. */
  const cliOk = cliCount(cliOut) > 0 && !cliBad.length && !badIds.length;
  const [catalog, setCatalog] = useState<CatalogArm[]>([]);
  const [installed, setInstalled] = useState<InstalledArm[]>([]);

  const [pick, setPick] = useState<CatalogArm | null>(null);
  /**
   * REUSE an entry already in the shared ledger — a third option, a peer of `pick`
   * and `paste`, NOT "paste its config and go down the custom path".
   *
   * The old version did exactly the latter, and it broke on the very first HTTP arm
   * (user, 25/08: Notion working in *Arms*, press reuse in *Personal assistant* →
   * **401**). The config in the ledger keeps the `${NOTION_ACCESS_TOKEN}`
   * placeholder; the custom path does not know which catalogue entry it is so it
   * shows no key field; the header goes out as the literal `Bearer ${…}`.
   * → `company.ts §reuseArm`
   */
  const [reuse, setReuse] = useState<InstalledArm | null>(null);
  /** Path B — paste an MCP config. No catalogue entry stands in anyone's way. → §4c */
  const [paste, setPaste] = useState('');
  /**
   * The server names in the pasted block. `parsePaste` takes only **the first** —
   * the note at the render site explains why that has to be shown on screen.
   */
  const pasted = pane === 'paste' ? safeJson(paste) : null;
  const serverNames =
    pasted && pasted['mcpServers'] && typeof pasted['mcpServers'] === 'object'
      ? Object.keys(pasted['mcpServers'] as Record<string, unknown>)
      : [];
  const firstServer = serverNames[0] ?? '';
  const extraServers = serverNames.slice(1);
  /** Accounts signed in for the selected entry. Key names, never tokens. */
  const [accounts, setAccounts] = useState<OAuthAccount[]>([]);
  const [account, setAccount] = useState('');
  const [logging, setLogging] = useState(false);
  /**
   * Which account the user pressed **Sign in again** for — `null` for an
   * ordinary "add another account".
   *
   * It exists only to answer one question afterwards: *did they end up
   * authorising the account they asked to repair?* The store cannot tell us —
   * from its side both outcomes are simply "an account was saved" — so the
   * INTENT has to be remembered here, at the click, and compared later.
   */
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  /**
   * The access level the user picked. Defaults to **the lowest** — safe before
   * anyone has chosen, and the only level that is always valid if the server
   * declares itself properly. → §6j
   */
  const [tier, setTier] = useState<'read' | 'add' | 'full'>('read');
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE TICKED TASK GROUPS — and they are **only asked at the full level**.  │
   * │ (the user's call, 27/08)                                                 │
   * │                                                                          │
   * │   *"read-only is the default and needs no picking; choose full access and│
   * │    you get a list, nothing ticked by default"*                           │
   * │                                                                          │
   * │ Why that is right, not merely because the user said so: **a question only│
   * │ has weight when it is WRITTEN**. Making someone weigh five checkboxes at │
   * │ read-only charges attention for a decision with no consequence — they    │
   * │ tick at random, and we have just taught them these boxes can be ticked at│
   * │ random. By the time it is genuinely dangerous the habit is formed.       │
   * │                                                                          │
   * │ Empty ⇒ **send nothing** ⇒ the server falls back to the catalogue's      │
   * │ `on: true` groups (`server.ts §armConfig`). Deliberately skips `[]`:     │
   * │ empty here means "not chosen", while a sent `[]` means "forbid           │
   * │ everything" — two different things, and merging them rebuilds exactly the│
   * │ *blank field ≠ empty key* case from `filledKeys`.                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const [groups, setGroups] = useState<string[]>([]);
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE ENTRY'S CHECKBOXES — different from `groups` in TWO ways, both        │
   * │ deliberate:                                                               │
   * │                                                                           │
   * │  ① They **have defaults that are on** (`option.on`), so the state has to  │
   * │     be loaded when the entry is picked rather than left empty. Empty here │
   * │     does NOT mean "not chosen" — unticking everything is a valid choice,  │
   * │     and it has to be sent as `[]`.                                        │
   * │  ② They are asked at **every level**, not only `full`: these say *how it  │
   * │     runs*, not *what it may do*, so the "only ask when it is written"     │
   * │     rule does not apply.                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const [options, setOptions] = useState<string[]>([]);
  /**
   * Are the browser and the daemon on the same machine — used to **hide** a
   * `loopbackOnly` checkbox.
   *
   * ⚠ This is ONLY about the interface. The real gate is on the server and is
   * measured from the **socket address** (`server.ts §armCtx`), which a client
   * cannot fake. Checking here keeps the button from being a riddle; checking
   * there keeps it from being decoration.
   */
  const sameMachine = /^(127\.|localhost$|\[::1\]$)/i.test(window.location.hostname);
  /**
   * Load the checkbox defaults whenever the entry changes — **keyed on `pick`, not
   * spread across four reset sites**. Those four are four chances to forget one,
   * and the forgotten one carries the previous entry's choices into the next,
   * silently.
   *
   * ⚠ A `loopbackOnly` box is never pre-ticked over a remote connection: the server
   * would refuse it, and the user never ticked it.
   */
  useEffect(() => {
    setOptions(
      (pick?.options ?? [])
        .filter((o) => o.on && (sameMachine || !o.loopbackOnly))
        .map((o) => o.id),
    );
  }, [pick, sameMachine]);
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE APP INSTALLATION — LOOKED UP AUTOMATICALLY, 0 characters typed.      │
   * │ → SPEC-arms §5h·7o (the user's call, 27/08: *"type nothing, just press   │
   * │ test and have it test automatically"*)                                   │
   * │                                                                          │
   * │ Three states, and they **cannot be merged**:                             │
   * │   `null`               not looked up yet (no account chosen)             │
   * │   `{failed:true}`      COULD NOT LOOK UP → let through, say so honestly  │
   * │   `{installed:[…]}`    looked up → empty BLOCKS, non-empty passes        │
   * │                                                                          │
   * │ Merging `failed` with `installed: []` either wrongly blocks someone who  │
   * │ did install (a network blip) or waves through someone who did not. The   │
   * │ two failures run in opposite directions.                                 │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const [scan, setScan] = useState<RepoScanState>(null);
  const [scanning, setScanning] = useState(false);
  /**
   * The user asserting they did install, despite an empty lookup. → a required
   * escape hatch.
   *
   * Why it has to exist: `search user:<login>` **cannot see an organisation's
   * repos**, so "empty" does not prove "nothing installed". Hard-blocking here
   * imprisons someone who did everything right, and there is no way out of that
   * except closing the app.
   */
  const [anyway, setAnyway] = useState(false);
  /**
   * The "use your own app" field. `own` = this company travels under THEIR
   * identity.
   *
   * Two states, not one: `clientId` is what is being typed, `own` is what was
   * SAVED. Infer `own` from `clientId !== ''` and the "active" badge lights up on
   * the first keystroke — a label describing a state that does not exist yet.
   */
  const [clientId, setClientId] = useState('');
  const [own, setOwn] = useState(false);
  const [label, setLabel] = useState('');
  const [folders, setFolders] = useState('');
  const [keys, setKeys] = useState<Record<string, string>>({});

  const [testing, setTesting] = useState(false);
  /** Past 6 seconds — a threshold for EXPLAINING, not for predicting. */
  const [slow, setSlow] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState('');
  const [grant, setGrant] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** An orphan awaiting **delete-for-good** confirmation — the one irreversible step. */
  const [forget, setForget] = useState<InstalledArm | null>(null);
  /** A workspace awaiting FORGET confirmation. The server also revokes at the service. */
  const [dropWs, setDropWs] = useState<OAuthAccount | null>(null);

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ WIPE THE KEYS FROM MEMORY ON CLOSE — not on the next open.               │
   * │ (the user asked 26/08: *"make sure it keeps no trace at all on the FE"*) │
   * │                                                                          │
   * │ The previous version only cleared on OPEN, so a key's value sat in React │
   * │ state for the rest of the working session after the user pressed Done    │
   * │ and moved on. There is no reason for it to be there — the dialog has     │
   * │ already sent it.                                                         │
   * │                                                                          │
   * │ ⚠ State the scope honestly, do not oversell: this does NOT stop someone  │
   * │ already running code in your tab (they can read the input directly). What│
   * │ it narrows is the **time window** in which a secret string sits in the   │
   * │ heap — and therefore in every heap snapshot, devtools session and        │
   * │ automatic crash report.                                                  │
   * │                                                                          │
   * │ The REAL fence is on the server and already exists: `listArms` returns   │
   * │ key **names**, never values; `company.yaml` holds only `${NAME}`         │
   * │ placeholders; and values travel ONE way — from the browser down to       │
   * │ `.state/secrets.json`, with no route reading back up.                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  useEffect(() => {
    if (open) return;
    setKeys({});
    setPaste('');
    setProbe(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setPane('type');
    // The Commands tab's folder picker: reopen the dialog with it still up and the
    // user meets a modal on top of a modal that nobody asked for.
    setBrowsing(false);
    setCliReady(false);
    setCliCwd('');
    setPick(null);
    setReuse(null);
    setPaste('');
    setLabel('');
    autoLabel.current = '';
    setFolders('');
    setKeys({});
    setProbe(null);
    setErr('');
    setGrant([]);
    setAccount('');
    setAccounts([]);
    setTier('read');
    setGroups([]);
    void api.armCatalog().then((r) => setCatalog(r.arms)).catch(() => undefined);
    /**
     * ⚠ FILTER AT THE SOURCE: keep only arms THIS office does not already have.
     *
     * The previous version listed the whole ledger, so an entry this office was
     * already using still appeared — click it and you go through pick → a ~20
     * second test → grant → and only then get refused. Displaying a choice that is
     * CERTAIN to fail and letting the user walk into it is worse than any
     * well-written error message.
     */
    void api.arms().then((r) => setInstalled(forList(r.arms, officeId))).catch(() => undefined);
  }, [open, officeId]);

  const agents = (canvas?.nodes ?? []).filter((n) => n.kind === 'agent' && n.role);
  /** The selected workspace — so the config screen names it rather than just saying "Notion". */
  const pickedAccount = accounts.find((a) => a.name === account);

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 THE DEFAULT NAME **FOLLOWS** THE ACCOUNT — change account, change     │
   * │ name. (bug caught 27/08)                                                 │
   * │                                                                          │
   * │ > *"Why does switching the workspace account to hubot leave the mcp      │
   * │ >  server node still called GitHub · octocat"* … *"you can read the      │
   * │ >  workspace name — when I switch, why is the name frozen?"*              │
   * │                                                                          │
   * │ The old version compared `cur === pick.name` to decide *"is the label     │
   * │ still auto-generated"*. That comparison is true EXACTLY ONCE: after the  │
   * │ first write `cur` is *"GitHub · octocat"* and no longer equals           │
   * │ `pick.name` ⇒ every later account change falls into the *"the user named │
   * │ it themselves"* branch and is skipped. The label freezes on the FIRST    │
   * │ account while the config points at the new one — and on the diagram that │
   * │ label is the ONLY readable name, so the lie has nothing contradicting it.│
   * │                                                                          │
   * │ ⇒ Fixed by remembering **the exact string we wrote** (`autoLabel`)        │
   * │ instead of inferring it. Still matching ⇒ auto-generated, overwrite      │
   * │ freely. Different ⇒ the user typed their own name, DO NOT TOUCH. The     │
   * │ gate is still there; it just stopped expiring after the first use.       │
   * │                                                                          │
   * │ ⚠ Still **ONLY the account name, NEVER the access level**: labels change │
   * │ freely, so a level inside one is a promise a rename can revoke. The      │
   * │ level lives in the badge, derived from `level`. → §6j                    │
   * │                                                                          │
   * │ ⚠ And the label is NOT the only support: the diagram node truncates to   │
   * │ 14 characters (*"GitHub · minhv…"*), so it also draws `via` on a second  │
   * │ line — resolved by the server from `arms[].secrets` on every read, so it │
   * │ cannot go stale. → `canvas/NodeShape.tsx`                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const autoLabel = useRef('');
  useEffect(() => {
    if (!pick?.needsLogin || !pickedAccount?.label) return;
    // The user typed their own name ⇒ stand still. The ref is written OUTSIDE the
    // `setLabel` updater: an updater has to be pure, and React calls it twice under
    // StrictMode.
    if (label !== pick.name && label !== autoLabel.current) return;
    const next = `${pick.name} · ${pickedAccount.label}`;
    autoLabel.current = next;
    setLabel(next);
  }, [pick, pickedAccount, label]);

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE "REUSE" LIST — **FILTERED TO THE OPEN TAB'S KIND**. (bug 26/08)      │
   * │                                                                          │
   * │ Reported: *"I go into the Services tab and it still suggests arms of     │
   * │ other kinds plugged in elsewhere. Same on Custom."*                      │
   * │                                                                          │
   * │ The old version left this block OUTSIDE every `pane` branch, so it showed│
   * │ the same content on all three screens — someone looking for Notion had to│
   * │ scroll past four folder arms. A "suggestion" list that does not filter by│
   * │ context is not a suggestion, it is labelled noise.                       │
   * │                                                                          │
   * │ ⚠ Orphans **of that kind** still have to appear (the user said so        │
   * │ explicitly) — they sink to the bottom and carry a bin icon rather than   │
   * │ being hidden: this is the **only** place they can be cleared without     │
   * │ opening `company.yaml`.                                                  │
   * │                                                                          │
   * │ ⚠ CORRECTION 26/08 — the user pushed back, and was right:                │
   * │   *"the modal has 3 choices, right — keep suggesting everything there    │
   * │    (all MCPs). Only filter by type once you're inside a type."*          │
   * │                                                                          │
   * │ I had cut the list from the KIND screen entirely, arguing *"three cards  │
   * │ are the whole question"*. What that missed: that screen is the **landing │
   * │ screen**, and someone coming back to plug in what they already have      │
   * │ should not have to guess which tab it is under. Filtering is for         │
   * │ **narrowing once you know what you are looking for**, not for hiding.    │
   * │                                                                          │
   * │ ⇒ No `kind` = show everything (the landing screen). With `kind` = already│
   * │ inside a kind, show only that one.                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  function reuseList(kind?: Kind) {
    const list = byKind(
      kind ? installed.filter((a) => kindOf(a, catalog) === kind) : installed,
      catalog,
    );
    if (!list.length) return null;
    return (
      <>
        <div className="mt-4 text-[11px] uppercase tracking-wide text-muted">
          {t('arm.pluggedElsewhere')}
        </div>
        {/*
          TESTING ⇒ LOCK THE LIST. (the user's suggestion, 26/08)

          `runRef` already handles correctness (an old result cannot overwrite a
          new one). This block handles **not letting the user fall into it**: a
          clickable list while the screen is spinning is an invitation into exactly
          that trap.

          Dimmed, not hidden: hiding makes the layout jump, and that jump happens
          precisely while the user is looking elsewhere waiting for a result.
        */}
        <div
          className={`mt-1.5 flex flex-col gap-1 transition-opacity ${
            testing ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          {list.map((a) => (
            <div key={a.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  /*
                    REUSE THAT EXACT ENTRY; do not clone the config.

                    Identity is the config hash, so "copy it to a new id" is
                    meaningless: same config ⇒ same hash ⇒ still the same thing.
                    The "clone" the user wants lives at another layer — PRESENCE
                    per office (`role.mcp`), not a copy of the config. → §6i

                    ⚠ AND THAT IS EXACTLY WHAT THE OLD VERSION HERE BROKE. It
                    called `setPaste(JSON.stringify(a.config))` — pushing the entry
                    down the "CUSTOM" path, where nothing knows which key it needs.
                    stdio arms did not expose it (the key travels via `env`, and
                    `filesystem` needs none); the first HTTP arm broke immediately
                    — the placeholder went to Notion verbatim → 401. → §6i-bis
                  */
                  resetConfig();
                  setPick(null);
                  setReuse(a);
                  setLabel(a.label);
                  setStep(2);
                }}
                className="flex flex-1 items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-[13px] hover:border-accent"
              >
                {/*
                  The VENDOR's mark (falling back to the KIND when the vendor has
                  no logo) — the same function as the services grid and the kind
                  cards, so one entry keeps one mark from the landing screen all
                  the way to step 2. → `ArmIcon.tsx`
                */}
                <span className="shrink-0 text-muted">
                  <ArmIcon
                    mark={markOf(a.catalog, catalog)}
                    kind={kindOf(a, catalog)}
                    className="h-4 w-4"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.label}</span>
                  {/*
                    ┌────────────────────────────────────────────────────────┐
                    │ THE SECOND LINE: WORKSPACE + LEVEL. (user, 26/08)     │
                    │                                                        │
                    │   *"with a row of Notions you need to know which one"* │
                    │                                                        │
                    │ Both are DERIVED FROM DATA, never read off the name:   │
                    │  · `via`   ← the server resolves `arms[].secrets` to    │
                    │              the workspace name in the OAuth store     │
                    │  · `level` ← `arms[].level`, which lives in the hash    │
                    │                                                        │
                    │ Why not fold them into `label`: the label belongs to    │
                    │ the user and changes freely — put the level in the      │
                    │ string and one rename produces "Notion (writable)" on   │
                    │ a read-only arm. A label lying about privilege. → §6j  │
                    └────────────────────────────────────────────────────────┘
                  */}
                  {(a.via || a.level) && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                      {a.via && <span className="truncate">{a.via}</span>}
                      {a.via && a.level && <span>·</span>}
                      {a.level && (
                        <span className={a.level === 'full' ? 'text-danger' : undefined}>
                          {t(LEVEL_SAY[a.level])}
                        </span>
                      )}
                      {a.toolCount ? (
                        <span className="tabular-nums">
                          · {plural('inspector.toolCount', a.toolCount)}
                        </span>
                      ) : null}
                    </span>
                  )}
                  {/*
                    A dead credential, on the row itself — so it is read BEFORE
                    the click, not after. Its own line rather than another item
                    on the line above: that line answers *"which one is this"*,
                    this one answers *"can it run at all"*, and merging them
                    buries the second question inside a row of `·` separators.
                  */}
                  {a.keyDead && (
                    <span className="mt-0.5 block truncate text-[11px] text-danger">
                      {t('arm.keyDeadShort')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 self-start text-[11px] text-muted">
                  {a.orphan ? t('overview.unused') : t('arm.reuseIt')}
                </span>
              </button>
              {/*
                DELETE FOR GOOD — shown only for an entry NO OFFICE HOLDS. Until
                today, removing an orphan from the ledger could only be done by
                **opening `company.yaml` and editing it by hand** — an ALARM BELL
                (§6a).

                The `a.orphan` condition comes from the SERVER, never inferred from
                `usedBy`: `usedBy` counts wires only, so a node sitting unwired on
                someone's diagram would look orphaned. The server checks again —
                this button only avoids displaying a choice certain to be refused.
              */}
              {a.orphan && (
                <button
                  type="button"
                  title={t('arm.forgetTip')}
                  aria-label={t('overview.deleteAgentAria', { label: a.label })}
                  onClick={() => setForget(a)}
                  className="shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  /**
   * A folder arm TESTS ITSELF as soon as the folder is chosen — the user presses
   * nothing. See the note on the Test button for why the test still has to run.
   */
  useEffect(() => {
    if (step === 2 && pick?.folders && folders.trim() && !probe && !testing) void test();
    // Keyed on `folders` alone: adding `probe`/`testing` here makes it call itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, step]);

  const folderList = () => folders.split('\n').map((s) => s.trim()).filter(Boolean);

  /**
   * Does this entry ask about task groups at the level currently chosen?
   *
   * Asked at `full` only: see the note on the `groups` state. The `pick.groups`
   * condition is the entry's own DATA, so an entry that declares no groups keeps
   * this screen quiet — there is no `id === 'github'` branch here.
   */
  const needGroups = () => Boolean(pick?.groups?.length) && tier === 'full';

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 A CHOICE AT STEP 1 = A BRAND-NEW CONFIG. (bug caught 26/08)           │
   * │                                                                          │
   * │ The flow they reconstructed: pick folder A → test ✓ → click an entry in  │
   * │ the suggestion list → **Back** → click "Folder on this machine" ⇒ **it   │
   * │ re-tests folder A by itself**. The user chose no A this time round, and  │
   * │ the machine went and tested A.                                           │
   * │                                                                          │
   * │ Root cause: `folders` (and `keys`, `tier`, `account`, `paste`) is state  │
   * │ of the whole dialog, while `setPick`/`setReuse` only change the PATH.    │
   * │ Go back and come in again and the old config is still sitting there, and │
   * │ the self-test `useEffect` sees its condition met and fires.              │
   * │                                                                          │
   * │ ⚠ THE USER OFFERED TWO OPTIONS, and I took (1) — "treat it as nothing    │
   * │   chosen": (2) keeping the old test result sounds convenient, but it is  │
   * │   **exactly the failure class** just fixed with `runRef`: a ✓ describing │
   * │   a config other than the one on screen. There it was out of date by a   │
   * │   few seconds; here it is out of date across a whole navigation loop —   │
   * │   harder to notice, not easier.                                          │
   * │                                                                          │
   * │ ⇒ The rule, said out loud: **what you just clicked is what you are       │
   * │ configuring.** Cleared in ONE function called from every entrance to     │
   * │ step 1 — patching button by button is how the fifth entrance added later │
   * │ becomes the one that is forgotten.                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  function resetConfig() {
    setFolders('');
    setKeys({});
    setPaste('');
    setProbe(null);
    setErr('');
    setTier('read');
    // Task groups and repo limits are CONFIG too, so they are cleared here with
    // everything else. Miss one and clicking another entry carries the previous
    // entry's limits along — the rule settled 26/08: *what you just clicked is what
    // you are configuring.*
    setGroups([]);
    setAccount('');
    // The PREVIOUS entry's auto-label must not count as this entry's "auto" value:
    // left behind, a name the user typed for the old entry can be silently
    // overwritten.
    autoLabel.current = '';
    // Any test in flight loses the right to write its result — see `runRef`.
    // Without this line an old run still lands and rebuilds the bug just fixed.
    runRef.current++;
    setTesting(false);
    setSlow(false);
    /**
     * ⚠ A device-code sign-in has to be cleared HERE too, for the same reason as
     * `runRef`.
     *
     * Miss it and going back then clicking another entry still shows a large code
     * belonging to **the previous entry** — and worse: the poll keeps running, so
     * it can "finish signing in" for a service the user is no longer standing in
     * front of. The rule settled 26/08: *what you just clicked is what you are
     * configuring.*
     */
    setDevice(null);
    setLogging(false);
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 CHANGING ACCOUNT ⇒ CLEAR EVERYTHING DOWNSTREAM. (the user's call,      │
   * │ 28/08)                                                                    │
   * │                                                                           │
   * │ > *"I pick a new account and the modal still shows the repo selection,    │
   * │ >  even the ticked tools — how am I supposed to control permissions?"*    │
   * │ > *"just clear it outright, make the user choose again from the start;    │
   * │ >  pampering the user is how an app turns into slop"*                     │
   * │                                                                           │
   * │ And they are right where it matters most: **the access level and the      │
   * │ task groups** are the two things that DECIDE what an employee may do.     │
   * │ Carrying them across an account change shows the user a choice they       │
   * │ weighed for **a different account**, and then they press Next — granting  │
   * │ permissions they never considered.                                        │
   * │                                                                           │
   * │ The old version cleared only `probe` (and only on the radio, not on the   │
   * │ auto-select path or the just-signed-in path) — i.e. "half a new config,   │
   * │ half an old one", precisely the *what you just clicked is what you are    │
   * │ configuring* class settled on 26/08.                                      │
   * │                                                                           │
   * │ ⚠ ONE function, EVERY entrance (radio · auto-select · just signed in).    │
   * │ Clearing in one place and forgetting the other is how this bug was born.  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /** A mirror of `account` for the functions with empty deps. See `loadAccounts`. */
  const accountRef = useRef('');
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  /**
   * A snapshot of the list BEFORE the next load — so we can tell what just
   * appeared. The same reason `accountRef` exists: `loadAccounts` has empty deps,
   * so the state in its closure is the first render's copy.
   */
  const accountsRef = useRef<OAuthAccount[]>([]);
  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  const chooseAccount = useCallback((name: string) => {
    setAccount(name);
    // The old Test result describes a DIFFERENT CONFIG (a placeholder carrying a
    // different key name).
    setProbe(null);
    // The level drops to the lowest — the safe default before anyone chooses. → §6j
    setTier('read');
    setGroups([]);
    // An app installation belongs to an ACCOUNT, so an old lookup is about someone
    // else.
    setScan(null);
    setAnyway(false);
    setErr('');
  }, []);

  /**
   * Load the accounts signed in for the selected entry, and auto-select the first.
   *
   * Called both on entering step 2 **and** after a sign-in completes. After a
   * sign-in the callback tab has closed and the user is looking at this dialog
   * again — if it does not reload itself they see the very *"not signed in"*
   * screen they just dealt with, and the only way forward is F5. That is the shape
   * of an app lying about its own state.
   */
  const loadAccounts = useCallback(
    /**
     * `justLoggedIn` — TWO CALLERS, TWO OPPOSITE INTENTS. (bug caught 30/08)
     *
     * > *"Why, when I add another workspace through the modal, does the selection
     * >  not move to it after it succeeds?"*
     *
     * The old version had one rule — *"auto-select only when nothing is selected"*
     * — and that rule is **right for the first caller**: entering step 2 must not
     * kick out what the user is half-configuring, because `chooseAccount` clears
     * the level, the groups and the Test result.
     *
     * But the second caller is **just signed in**, and there the intent is not
     * ambiguous at all: they pressed Sign in, chose a workspace, pressed Allow —
     * three steps all saying the same thing. Keeping the old selection there is the
     * app ignoring exactly what the user just did.
     *
     * ⚠ Select by **WHAT NEWLY APPEARED**, not by `accounts[0]` or the last
     * element: the server's ordering is not a contract, and depending on it builds
     * a silent bug for the day someone changes the sort.
     *
     * 📌 Signing in again to the SAME workspace ⇒ no new name ⇒ falls back to the
     * old rule and keeps the selection. Correct: there is nothing new to move to.
     */
    async (catalogId: string, justLoggedIn: boolean | string = false) => {
      const before = new Set(accountsRef.current.map((a) => a.name));
      const r = await api.oauthAccounts(catalogId).catch(() => null);
      if (!r) return;
      setAccounts(r.accounts);

      /**
       * ⚠ A NAME FROM THE SERVER BEATS THE DIFF, and this is not a tidy-up.
       * (the user asked the question that found it, 09/04)
       *
       * *"what if I sign in meaning one account but actually authorise a
       * different one — does it light up that one and still leave the
       * un-signed-in one selected?"* — with the diff alone, yes, exactly that.
       * Re-authorising an account that ALREADY EXISTS adds no new name, so
       * `fresh` is undefined, and the selection stays on the account the user
       * pressed the button for — which is still dead. They watch the OTHER
       * row's warning clear and conclude the one they clicked is fixed.
       *
       * The device-code path never had this hole: its poll result names the
       * saved account. The web flow now carries the same fact through the SSE
       * event, so both paths select **what was saved** rather than inferring.
       */
      if (typeof justLoggedIn === 'string') {
        if (r.accounts.some((a) => a.name === justLoggedIn)) {
          chooseAccount(justLoggedIn);
          return;
        }
      }

      // No name came with the event ⇒ fall back to the diff. Still right for
      // an ordinary "add another account", and never worse than before.
      if (justLoggedIn) {
        const fresh = r.accounts.find((a) => !before.has(a.name));
        if (fresh) {
          chooseAccount(fresh.name);
          return;
        }
      }
      /**
       * Auto-select only when NOTHING is selected — `chooseAccount` clears
       * everything downstream, so calling it over an existing selection deletes the
       * config the user is halfway through typing.
       *
       * ⚠ Read through `accountRef`, not through state: this function has empty
       * deps, so `account` in its closure is the first render's copy. And ⚠ do not
       * put the check inside a `setAccount` updater — an updater must be PURE, and
       * React calls it twice under StrictMode (the same trap avoided in
       * `autoLabel`).
       */
      const first = r.accounts[0]?.name;
      if (first && !accountRef.current) chooseAccount(first);
    },
    [chooseAccount],
  );

  useEffect(() => {
    if (step === 2 && pick?.needsLogin) void loadAccounts(pick.id);
  }, [step, pick, loadAccounts]);

  /**
   * LOOK UP THE APP INSTALLATION. → SPEC-arms §5h·7o
   *
   * ⚠ `scanRef` follows `runRef`'s shape: change account mid-lookup and the OLD
   * account's result must not be written onto a screen now describing the NEW one.
   * In `runRef` that produced a lying ✓; here it produces somebody else's list of
   * repos — which looks even more convincing.
   */
  /**
   * Load the client_id in use for this entry. Shown only when the company **has
   * pasted one** — agentco's own is left blank, because displaying it invites
   * people to edit something they should not touch, and a pre-filled field looks
   * like a required one.
   */
  useEffect(() => {
    if (step !== 2 || !pick?.deviceLogin) return;
    void api
      .oauthClient(pick.id)
      .then((r) => {
        setOwn(r.own);
        setClientId(r.own ? r.id : '');
      })
      .catch(() => undefined);
  }, [step, pick]);

  async function saveClientId() {
    if (!pick) return;
    try {
      const r = await api.setOauthClient(pick.id, clientId);
      setOwn(r.own);
      setClientId(r.own ? r.id : '');
      // Changing the application identity means existing keys belong to the OLD
      // client. Nothing is cleared, only stated: the old keys still work, but the
      // NEXT sign-in travels under the new client. Deleting keys on their behalf
      // throws away something that is working.
      setErr(
        r.own
          ? t('arm.clientSaved')
          : t('arm.clientCleared'),
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('arm.clientSaveFailed'));
    }
  }

  const scanRef = useRef(0);
  const runScan = useCallback(async () => {
    if (!pick?.repoScan || !account) return;
    const mine = ++scanRef.current;
    setScanning(true);
    setScan(null);
    setAnyway(false);
    const r = await api.armRepos(pick.id, account).catch(() => ({ failed: true }) as const);
    if (mine !== scanRef.current) return;
    setScan(r);
    setScanning(false);
  }, [pick, account]);

  /**
   * Runs by itself once there is an account — it waits for **no** click.
   *
   * This is the user's call: *"type nothing, just press test and have it test
   * automatically"*. It runs earlier than the Test button because it only needs a
   * KEY, not a config — so the user reads the result while still choosing the level
   * and the task groups.
   */
  useEffect(() => {
    if (step === 2 && pick?.repoScan && account) void runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pick, account]);

  /**
   * ⚠ LISTEN TO SSE to learn the callback tab finished. The daemon emits
   * `company.offices` after saving the key — the store's `armsVersion` bumps with
   * it, and this effect watches that.
   *
   * Not `window.open(...).onclose` and not polling: the callback tab is a separate
   * navigation, and the user can close it by hand before we would ever see it. The
   * server's event is the ONLY thing that knows for certain the key was saved.
   */
  const armsVersion = useApp((s) => s.armsVersion);
  const linkedAccount = useApp((s) => s.linkedAccount);
  useEffect(() => {
    if (step === 2 && pick?.needsLogin && logging) {
      setLogging(false);
      /**
       * The account NAME the daemon saved, when the event carried one —
       * otherwise `true`, which falls back to the list diff.
       * → the note inside `loadAccounts`
       */
      void loadAccounts(pick.id, linkedAccount ?? true);
      /**
       * ⚠ SIGNED IN AS SOMEONE ELSE ⇒ SAY IT. The credential store is now
       * correct either way, but the user's BELIEF is not: they pressed
       * "sign in again" on one row and a different row is what got repaired.
       * Staying quiet leaves them thinking the arm they came to fix works.
       */
      if (reconnecting && linkedAccount && linkedAccount !== reconnecting) {
        const who = accountsRef.current.find((a) => a.name === reconnecting);
        setErr(
          t('arm.reconnectedOther', {
            asked: who?.label ?? reconnecting,
            got: accountsRef.current.find((a) => a.name === linkedAccount)?.label ?? linkedAccount,
          }),
        );
      }
      setReconnecting(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armsVersion]);

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ FORGETTING A WORKSPACE — OPTIMISTIC UI. (user, 26/08: *"it stalls"*)     │
   * │                                                                          │
   * │ Removed from the list AT ONCE, the server called after. Revoking at the  │
   * │ service is a real network round trip (`revocation_endpoint`), so waiting │
   * │ for it before repainting makes the user watch a frozen button for work   │
   * │ that has **nothing to do with what they are looking at**.                │
   * │                                                                          │
   * │ ⚠ WHY OPTIMISM IS HONEST HERE AND NOT ELSEWHERE: the button is only      │
   * │ clickable while `usedBy` is empty, and that is the server's **only       │
   * │ reason to refuse**. What remains is a dead network. Optimistic properly  │
   * │ means "almost certain to succeed", not "never mind, roll back on         │
   * │ failure" — a list that flickers from rollbacks is far worse than a       │
   * │ button that stalls for half a second.                                    │
   * │                                                                          │
   * │ ⚠ AND IT STILL HAS TO ROLL BACK. "Almost certain" is not "certain", and  │
   * │ an interface lying about a deletion is worse than any amount of waiting. │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  function dropNow(): void {
    const a = dropWs;
    if (!a || !pick) return;
    const before = accounts;

    setDropWs(null);
    setAccounts((list) => list.filter((x) => x.name !== a.name));
    // If it is the current selection, deselect — otherwise `payload()` sends a key
    // name that was just deleted and the user gets an error for the thing they
    // deliberately did.
    setAccount((cur) => (cur === a.name ? '' : cur));
    setProbe(null);

    void api
      .oauthForget(a.name)
      // Reload from the server afterwards: the `usedBy` of the REMAINING entries
      // may have changed, and the optimistic version only knows about the one just
      // removed.
      .then(() => loadAccounts(pick.id))
      .catch((e) => {
        setAccounts(before);
        setErr(e instanceof ApiError ? e.message : t('arm.dropFailed'));
      });
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A DEVICE-CODE SIGN-IN in flight. → SPEC-arms §5h·7                      │
   * │                                                                          │
   * │ ⚠ THERE IS NO SECRET HERE. `state` only points at a session living in the│
   * │ daemon; `userCode` is the thing the user has to BE ABLE TO READ and type │
   * │ elsewhere. That is why this block is allowed to live in React state,     │
   * │ unlike the web flow's `code_verifier` (which never leaves the daemon).   │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const [device, setDevice] = useState<DeviceLogin | null>(null);
  /** A countdown, recomputed every second — the code really does die, and the user must see it. */
  const [now, setNow] = useState(() => Date.now());

  /**
   * THE POLL LOOP — the interval is THE SERVER'S (`intervalMs`), not a constant
   * here.
   *
   * ⚠ RFC 8628's `slow_down` widens the interval, and the server returns the new
   * one in each response. Pinning a constant on the client ignores that instruction
   * and gets you blocked by the vendor — a bug that only appears on a slow network,
   * i.e. exactly when it is hardest to reproduce.
   */
  useEffect(() => {
    if (!device || !pick) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (wait: number): Promise<void> => {
      timer = setTimeout(async () => {
        if (!alive) return;
        try {
          const r = await api.oauthDevicePoll(device.state);
          if (!alive) return;
          if (r.state === 'done') {
            setDevice(null);
            setLogging(false);
            await loadAccounts(pick.id);
            // The account just linked is the thing they just made — select it, and
            // clear everything chosen for the PREVIOUS one. → `chooseAccount`
            chooseAccount(r.name);
            /**
             * ⚠ Same check as the web flow: on this path the service decides
             * who signs in, and *"repair the acme-team account"* can come back
             * as *"acme-personal is now fine"*. The selection above is correct;
             * what would be wrong is letting the user keep believing the row
             * they clicked got fixed. → `reconnecting`
             */
            if (reconnecting && r.name !== reconnecting) {
              const asked = accountsRef.current.find((x) => x.name === reconnecting);
              setErr(t('arm.reconnectedOther', { asked: asked?.label ?? reconnecting, got: r.label ?? r.name }));
            }
            setReconnecting(null);
            return;
          }
          void tick(r.intervalMs);
        } catch (e) {
          if (!alive) return;
          /**
           * 🔴 A FAILURE HERE STOPS, and has to be said — unlike the network layer.
           *
           * The daemon's `devicePoll` already swallows every TEMPORARY error into
           * `pending` (a dropped connection must not kill an authorisation that
           * succeeded, §5h·7g). So what reaches here is only: the code expired, the
           * user pressed Deny, or the session was cleared. None of the three **heal
           * themselves** ⇒ retrying quietly leaves the user watching a spinner
           * forever.
           */
          setDevice(null);
          setLogging(false);
          setErr(e instanceof ApiError ? e.message : t('arm.loginStopped'));
        }
      }, wait);
    };
    void tick(device.intervalMs);

    // The countdown runs on its own: it only draws, and must not depend on the poll
    // interval.
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, pick]);

  /**
   * On expiry it **clears itself**, rather than waiting for the user to notice.
   *
   * A dead code still on screen is an invitation to type it somewhere for nothing —
   * and whoever types it gets an error from GitHub and starts looking for the cause
   * on their own side.
   */
  useEffect(() => {
    if (device && now > device.expiresAt) {
      setDevice(null);
      setLogging(false);
      setErr(t('arm.codeExpired'));
    }
  }, [now, device]);

  /**
   * `entry` defaults to the current selection, and is passed EXPLICITLY by the
   * one caller that starts a sign-in in the same click that selects the
   * catalogue entry (reconnecting a dead credential from the reuse panel).
   * `setPick` has not landed yet at that moment, so reading `pick` from the
   * closure there would find `null` and the click would do nothing at all —
   * a button that silently does nothing being the worst of the options.
   */
  async function login(entry: CatalogArm | null = pick) {
    if (!entry) return;
    setErr('');
    setLogging(true);
    /**
     * ⚠ CLEAR ON THE CLICK, not when the sign-in finishes. (user, 28/08)
     *
     * *"while adding another account: the modal should clear all its weakly
     * dependent entities… only show them again once the selection is settled"*
     *
     * Clearing here makes the scope block, the installation, the level and the task
     * groups **disappear the moment they click**, instead of sitting there
     * describing the old account for the whole sign-in. Without this they stare at
     * a screen mixing two accounts for ~30 seconds — precisely when *"whose
     * permission is this"* is hardest to answer.
     *
     * The price, weighed: mis-click then ✕ and a half-made level/group choice is
     * lost. That direction was chosen because the two failures are not equal —
     * losing a few clicks is visible immediately, while granting permissions for an
     * account you never examined is visible not at all.
     */
    setProbe(null);
    setTier('read');
    setGroups([]);
    setScan(null);
    setAnyway(false);

    /**
     * THE DEVICE-CODE PATH — for vendors with no dynamic registration (GitHub).
     *
     * No mandatory `window.open`: the user may be sitting at another machine with a
     * phone in their hand, and **that is exactly the case the device flow exists
     * for**. We show the code plus a button that opens it for them, without
     * assuming this browser is where they will approve.
     */
    if (entry.deviceLogin) {
      try {
        const d = await api.oauthDeviceStart(entry.id);
        // The "copied" mark is cleared by `key={device.state}` at the render site,
        // not by a `setCopied(false)` here: that state now lives inside
        // `DeviceCode`, and a new attempt is a new `state` ⇒ React rebuilds the
        // block, clean.
        setNow(Date.now());
        setDevice(d);
      } catch (e) {
        setLogging(false);
        setErr(e instanceof ApiError ? e.message : t('arm.codeFailed'));
      }
      return;
    }

    try {
      const { authUrl } = await api.oauthStart(entry.id);
      /**
       * OPEN THE TAB FROM HERE; never let the daemon `spawn` a browser.
       *
       * 🔴 Two failure classes deleted at once: (1) the machine's default browser
       * may not be signed in to the service while the one showing agentco is — the
       * user hit that on their first attempt, 24/08; (2) `cmd /c start` on Windows
       * truncates a URL at the first `&`, and an OAuth URL **always** has one. No
       * shell ⇒ nothing to truncate.
       */
      window.open(authUrl, '_blank', 'noopener');
    } catch (e) {
      setLogging(false);
      setErr(e instanceof ApiError ? e.message : t('arm.loginPageFailed'));
    }
  }

  /**
   * What goes to the server. A catalogue entry sends **`catalogId` + folders** and
   * lets THE SERVER build it — the client no longer assembles an
   * `npx …@version` string.
   *
   * The previous version assembled it client-side, which pinned the package version
   * in TWO places. Two copies of one constant have burned this project once already
   * (`agentSlot` vs `arrange`).
   */
  function payload():
    | {
        armId?: string;
        config?: Record<string, unknown>;
        catalogId?: string;
        folders?: string[];
        account?: string;
        level?: 'read' | 'add' | 'full';
        groups?: string[];
        options?: string[];
      }
    | null {
    // Reuse: send only the HASH. The config, the key name and the key value are all
    // on the server already — sending copies of them over HTTP opens the door to two
    // versions drifting apart.
    if (reuse) return { armId: reuse.id };
    if (pick) {
      if (pick.folders && folderList().length === 0) return null;
      // Needs a sign-in but no account chosen ⇒ the config cannot be built: the
      // `${OAUTH}` placeholder has no name to substitute. Return `null` so the Test
      // button stays quiet, rather than sending it and receiving a technical error.
      if (pick.needsLogin && !account) return null;
      // Full access with no group ticked ⇒ the config cannot be built. Return `null`
      // so the Test button stays quiet, exactly like the "no account" case above —
      // rather than sending it and getting back an arm wider than the user intended.
      if (needGroups() && !groups.length) return null;
      return {
        catalogId: pick.id,
        folders: folderList(),
        ...(account ? { account } : {}),
        ...(pick.tiered ? { level: tier } : {}),
        ...(groups.length ? { groups } : {}),
        /**
         * ⚠ SENT EVEN WHEN EMPTY — the opposite of `groups` just above.
         *
         * The server reads `undefined` as *"the client said nothing"* ⇒ falls back
         * to **the defaults that are on**; an empty array means *"the user unticked
         * everything"*. Using `...(len ? … : {})` here turns a deliberate untick
         * into a click that **does nothing**, and the user will not understand why.
         * → `server.ts §armConfig`
         */
        ...(pick.options?.length ? { options } : {}),
      };
    }
    const cfg = parsePaste();
    return cfg ? { config: cfg } : null;
  }

  /**
   * `${NAME}` placeholders in a PASTED config → generate key fields for exactly
   * those. The client-side twin of `secrets.ts §missingSecretRefs`.
   *
   * The custom path used to have no key fields at all, so every HTTP server needing
   * a token was a dead end: paste, test, 401, nowhere to go. A catalogue entry
   * declares its key names — but those names are not secret, they are right there in
   * the config the user just pasted. Reading them out is enough, and it works for
   * EVERY vendor without our knowing which vendor in advance.
   */
  const pastedKeys = (): string[] => {
    if (pick || reuse) return [];
    const cfg = parsePaste();
    if (!cfg) return [];
    const seen = new Set<string>();
    for (const m of JSON.stringify(cfg).matchAll(/\$\{([A-Z0-9_]+)\}/g)) seen.add(m[1]!);
    return [...seen].sort();
  };

  /**
   * The catalogue entry sharing a HOSTNAME with the URL just pasted.
   *
   * Only to **point the way**, never to switch for them: the user chose the custom
   * path deliberately, and jumping them somewhere else takes their decision away. A
   * suggestion is read, and then they choose.
   */
  const catalogMatch = (): CatalogArm | undefined => {
    const cfg = parsePaste();
    const url = cfg && typeof cfg['url'] === 'string' ? cfg['url'] : '';
    if (!url) return undefined;
    try {
      const host = new URL(url).hostname;
      return catalog.find((c) => c.host === host);
    } catch {
      return undefined;
    }
  };

  /** A blank field is NOT an empty key — it is a key NOT YET FILLED IN. Do not send it. */
  const filledKeys = (): Record<string, string> =>
    Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim() !== ''));

  /** The JSON block the user pasted. `null` = not readable yet. */
  function parsePaste(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(paste) as Record<string, unknown>;
      // Accept both shapes: a `{"mcpServers":{"name":{…}}}` block copied straight
      // from a README, and a bare config block. Making the user unwrap it by hand
      // makes them understand a format — exactly what all of §6 exists to avoid.
      const servers = parsed['mcpServers'];
      if (servers && typeof servers === 'object') {
        /**
         * ⚠ `[0]` — THE FIRST SERVER ONLY. This is a decision, and it has to be
         * **said on screen** rather than sitting quietly in a comment: see
         * `extraServers`. A README block with two servers otherwise means the user
         * presses Done, receives exactly one arm, and gets **no symptom at all**.
         * → [[agentco-silent-allowlist]]
         */
        const [name, cfg] = Object.entries(servers as Record<string, unknown>)[0] ?? [];
        if (name && !label) setLabel(name);
        return (cfg as Record<string, unknown>) ?? null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 A RUN SEQUENCE NUMBER — stops an OLD RESPONSE OVERWRITING A NEW ONE.  │
   * │ (bug caught 26/08)                                                       │
   * │                                                                          │
   * │   *"I pick a folder, it's connecting, I quickly switch to another folder │
   * │    (Music)… whose test is running now??"*                                │
   * │                                                                          │
   * │ The FIRST one's. A test takes 8–20 seconds; change folder midway and the │
   * │ old run is **still in flight**, and when it lands `setProbe` writes      │
   * │ folder A's result onto a screen now configuring folder B. The user sees  │
   * │ a ✓, presses Done, and what gets saved is B — **B was never tested.**    │
   * │                                                                          │
   * │ This is the *"the system lies about its own state"* class, and it is     │
   * │ worse than an ordinary bug: that ✓ is **the entire** thing step 2 exists │
   * │ to sell.                                                                 │
   * │                                                                          │
   * │ ⚠ `AbortController` is not the tool for this: it cancels the HTTP request│
   * │ but **not** the test running on the server (which has already spawned an │
   * │ MCP process). What is needed is not "stop the old run" but **"stop       │
   * │ listening to the old run"**.                                             │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const runRef = useRef(0);

  async function test() {
    const p = payload();
    if (!p) {
      setErr(
        pick?.needsLogin && !account
          ? t('arm.needAccount')
          : needGroups() && !groups.length
            ? t('arm.needGroups')
            : pick?.folders
              ? t('arm.needFolder')
              : t('arm.badConfig'),
      );
      return;
    }
    setErr('');
    setTesting(true);
    setSlow(false);
    setProbe(null);
    const mine = ++runRef.current;
    const tick = setTimeout(() => setSlow(true), 6_000);
    try {
      const k = filledKeys();
      /**
       * ⚠ `office` MUST RIDE ALONG, even though Test plugs nothing into any office.
       *
       * The `<OFFICE_STATE>` placeholder is filled **per office** (`server.ts
       * §officeStateDir`). Without it the Test run uses a path with the placeholder
       * still in it ⇒ the browser creates a directory literally named
       * `<OFFICE_STATE>` beside the daemon, and more importantly: **Test checks a
       * config other than the one that will run** — the very invariant
       * `injectSecrets` exists to hold.
       */
      const r = await api.testArm('probe', {
        ...p,
        ...(Object.keys(k).length ? { secrets: k } : {}),
        ...(officeId ? { office: officeId } : {}),
      });
      // ⚠ THE GUARD: the config changed while this run was in flight ⇒ this result
      // describes something OTHER than what is on screen. Drop it, silently — a new
      // run has already started and that one is the right one. → `runRef`
      if (mine !== runRef.current) return;
      setProbe(r);
    } catch (e) {
      if (mine !== runRef.current) return;
      setErr(e instanceof ApiError ? e.message : t('arm.testFailed'));
    } finally {
      // Only the LATEST run may turn `testing`/`slow` off: an old run landing after
      // a new one and stopping the spinner tells the screen "done" while it waits.
      if (mine === runRef.current) {
        clearTimeout(tick);
        setTesting(false);
        setSlow(false);
      }
    }
  }

  async function save() {
    const p = payload();
    const name = (label || pick?.name || '').trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      const k = filledKeys();
      await api.addArm({
        ...(name ? { label: name } : {}),
        ...p,
        ...(Object.keys(k).length ? { secrets: k } : {}),
        ...(officeId ? { office: officeId } : {}),
        ...(grant.length ? { grantTo: grant } : {}),
      });
      // Re-read the canvas from the server rather than patching state here: MCP
      // nodes are REBUILT by `layout.read()` from `company.mcpServers`, so the
      // source of truth is the server. Patching by hand builds a second copy of one
      // rule.
      await actions.refreshCanvas();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ A ✓ IS NOT ENOUGH TO PROCEED — the second half is **is the config still   │
   * │ valid**.                                                                  │
   * │                                                                           │
   * │ The real case: test at read-only (✓), then switch to **full access**. The │
   * │ group picker appears with 0 ticked, but the old ✓ is still there ⇒ Next   │
   * │ stays clickable ⇒ a full-access arm is saved falling back to the DEFAULT  │
   * │ groups, i.e. wider than what the user was just asked about. It fails in   │
   * │ the direction of **more permission**, with no symptom on screen.          │
   * │                                                                           │
   * │ The same family as `runRef`: *a ✓ describing a config other than the one  │
   * │ on screen*. There it was stale by seconds; here it is stale by one click. │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const ok =
    probe?.status === 'connected' &&
    !probe.warn &&
    /**
     * 🔴 A FAILED REACH TEST ⇒ NO PROCEEDING. (caught 27/08)
     *
     *   *"It's showing a 404 warning right now and still lets me press Next?"*
     *
     * Right, and it was a contradiction of our own making: the screen said *"cannot
     * reach this repo"* and opened the door forward in the same breath. The user
     * reads two opposite statements and will believe **the button**, not the text —
     * the button is the thing they can press.
     *
     * A warning that blocks nothing is not a warning, it is decoration, and it
     * teaches the user to skip every other warning. The same argument used for the
     * stale badge (*"a label that cries wolf teaches people to ignore it"*).
     */
    /**
     * 🔴 NO APP INSTALLED ON ANY REPO ⇒ NO PROCEEDING. (the user's call, 27/08)
     *
     *   *"If there is none, or the user hasn't installed it, require them to
     *    install before being allowed to continue"*  ·  *"it shows a 404 warning
     *    and still lets me press Next?"*
     *
     * Blocks **only when the lookup worked and came back empty**. The other two
     * cases pass:
     *   · `failed`  — the lookup did not work, so blocking blocks the innocent (a
     *                 network blip looks the same)
     *   · `anyway`  — the user asserts they installed it, and they may be right:
     *                 the lookup is blind to an ORGANISATION's repos.
     *
     * The "block + explicit escape hatch" pair is the ground between two failures:
     * a bare warning nobody reads, and a hard block that imprisons someone who did
     * everything right.
     */
    !(scan && !('failed' in scan) && scan.installed.length === 0 && !anyway) &&
    !(needGroups() && !groups.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        WIDER THAN THE DEFAULT — 46rem instead of 28rem. (the user's call, 01/09)

        Not cosmetic: the Commands tab puts **the label on the same line as the
        input** (`Field`), and at 28rem the 150px label column eats a third of it
        while the Syntax field — which holds a real command line — is narrow enough
        to need horizontal scrolling to re-read what you just typed.

        ⚠ Wider for the WHOLE dialog, not just the Commands tab: a modal that
        changes width on a tab switch is a page jumping under the hand pressing it.
      */}
      <DialogContent className={DIALOG_W}>
        <DialogHeader>
          <DialogTitle>
            {step === 1
              ? t('arm.step1Title')
              : step === 2
                ? /*
                    The icon travels WITH the name at step 2 — this is "carried
                    through the inner steps" (user, 27/08). It's also a visual
                    lock: pick the wrong card at step 1 and you see it right
                    here, instead of only catching it once you read the brand
                    name buried in a long sentence.
                  */
                  (
                    <span className="inline-flex items-center gap-2">
                      <span className="text-muted">
                        <ArmIcon
                          mark={pick ? pick.brand.mark : markOf(reuse?.catalog, catalog)}
                          kind={
                            pick
                              ? pick.folders
                                ? 'files'
                                : 'service'
                              : reuse
                                ? kindOf(reuse, catalog)
                                : 'custom'
                          }
                          className="h-4 w-4"
                        />
                      </span>
                      {t('arm.step2Title', { name: pick?.name ?? label ?? '' })}
                    </span>
                  )
                : t('arm.step3Title')}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? t('arm.step1Desc')
              : step === 2
                ? t('arm.step2Desc')
                : t('arm.step3Desc')}
          </DialogDescription>
        </DialogHeader>

        {/* ─────────────────────────────────────────────── Step 1 · Choose */}
        {step === 1 && (
          <div className="max-h-[52vh] overflow-y-auto">
            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ TYPE FIRST, service second. (the user's call, 23/08)         │
              │                                                              │
              │ The previous version laid out catalog cards flat: "Local     │
              │ files" sat level with "Notion". Wrong layer — the user       │
              │ thinks *"let it read this folder"*, not *"install            │
              │ an MCP server"*. That a folder gets served BY an MCP is our  │
              │ business, not theirs, and showing it makes them learn our    │
              │ vocabulary.                                                  │
              │                                                              │
              │ These three types differ in what the USER has to do next,    │
              │ not in what runs underneath — that's the axis that actually  │
              │ sorts them.                                                  │
              └──────────────────────────────────────────────────────────────┘
            */}
            {pane === 'type' && (
              // Four types as of 01/09 — `grid-cols-2`, not `cols-4`: four cards
              // on one row in this dialog means four narrow columns, and the
              // `say` text wraps to three lines.
              <div className="grid grid-cols-2 gap-2">
                <TypeCard
                  icon={<ArmIcon kind="files" className="h-6 w-6" />}
                  name={t('arm.typeFiles')}
                  say={t('arm.typeFilesSay')}
                  onClick={() => {
                    const files = catalog.find((a) => a.folders);
                    if (!files) return;
                    /*
                      ┌──────────────────────────────────────────────────────┐
                      │ GO STRAIGHT TO STEP 2 — no intermediate screen.      │
                      │ (user, 26/08, and I agree for a second reason they   │
                      │ didn't name)                                         │
                      │                                                      │
                      │ They said *"it feels like you have to click Choose   │
                      │ folder twice"*. The root isn't the click count —     │
                      │ **the button lied**: "Choose a different folder…"    │
                      │ doesn't open any picker, it just switches screens. A │
                      │ button named after an action that actually navigates │
                      │ will always feel like "two clicks", correctly.       │
                      │                                                      │
                      │ Relabeling would work too, but dropping the screen   │
                      │ entirely is better: the other three types all have   │
                      │ something to CHOOSE at step 1 (which service / what  │
                      │ to paste), while for folders the card already is the │
                      │ choice. The reuse list moves down to the foot of     │
                      │ step 2.                                              │
                      └──────────────────────────────────────────────────────┘
                    */
                    resetConfig();
                    setPick(files);
                    // Three paths are MUTUALLY EXCLUSIVE. Going back and picking
                    // a different one without clearing the old one lets
                    // `payload()` silently choose on the user's behalf.
                    setReuse(null);
                    setLabel(files.name);
                    setStep(2);
                  }}
                />
                <TypeCard
                  icon={<ArmIcon kind="service" className="h-6 w-6" />}
                  name={t('arm.typeService')}
                  say={t('arm.typeServiceSay', { n: catalog.filter((a) => !a.folders).length })}
                  onClick={() => setPane('catalog')}
                />
                <TypeCard
                  icon={<ArmIcon kind="cli" className="h-6 w-6" />}
                  name="CLI"
                  say={t('arm.typeCliSay')}
                  onClick={() => {
                    setActs([blankAct()]);
                    setCliJson(null);
                    // Entering the tab enters the FOLDER SCREEN — see the
                    // comment block there.
                    setCliReady(false);
                    setCliCwd('');
                    setPane('cli');
                  }}
                />
                <TypeCard
                  icon={<ArmIcon kind="custom" className="h-6 w-6" />}
                  name={t('arm.typeCustom')}
                  say={t('arm.typeCustomSay')}
                  onClick={() => setPane('paste')}
                />
              </div>
            )}

            {pane === 'catalog' && (
              <>
                <Button size="sm" className="mb-2" onClick={() => setPane('type')}>
                  {t('arm.back')}
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  {catalog
                    .filter((a) => !a.folders)
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          resetConfig();
                          setPick(a);
                          setReuse(null);
                          setLabel(a.name);
                          setStep(2);
                        }}
                        className="rounded-lg border border-line px-3 py-3 text-left transition hover:border-accent hover:bg-accent-soft"
                      >
                        <div className="text-muted">
                          <ArmIcon mark={a.brand.mark} kind={a.shape === 'browser' ? 'browser' : a.folders ? 'files' : 'service'} className="h-6 w-6" />
                        </div>
                        <div className="mt-1 text-[13px] font-medium">{a.name}</div>
                        {/* THE PRICE, not the feature. → §6f */}
                        <div className="mt-0.5 text-[11px] text-muted">{t(PRICE_SAY[a.price])}</div>
                      </button>
                    ))}
                  {catalog.filter((a) => !a.folders).length === 0 && (
                    <p className="col-span-3 text-[13px] text-muted">
                      {t('arm.noCatalogBefore')} <b>{t('arm.noCatalogBold')}</b>{' '}
                      {t('arm.noCatalogAfter')}
                    </p>
                  )}
                </div>
                {reuseList('service')}
              </>
            )}

            {/*
              THE LANDING SCREEN: suggest **everything**, unfiltered. Someone
              coming back to plug in what they already have shouldn't have to
              guess which tab it lives under. Filtering is for narrowing once
              you already know what you're looking for — not for hiding.
              (user, 26/08)
            */}
            {pane === 'type' && reuseList()}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ THE FOLDER SCREEN COMES BEFORE THE COMMAND LIST.             │
              │ (the user's call, 01/09)                                     │
              │                                                              │
              │  *"pick tab → folder picker → and after that every command   │
              │   in the list operates from that office once it runs"*       │
              │                                                              │
              │ Why this is right, not just because the user said so: a CLI  │
              │ arm **is a project**. The folder is a question with          │
              │ **exactly one** right answer for the whole arm, and asking   │
              │ it per command invites drift — then the third command can't  │
              │ find a file and nobody knows why. Ask once, answer once.     │
              │                                                              │
              │ ⚠ And it must come FIRST: writing five commands and only     │
              │ then discovering the wrong folder means re-reading all five. │
              │                                                              │
              │ 🔴 CORRECTION 01/09 — my first draft had TWO buttons: "Choose│
              │ folder…" and "Use office folder →". The user rejected it,    │
              │ and they were right:                                         │
              │                                                              │
              │   *"There's only ONE Choose folder… button, and the folder   │
              │    that button defaults to is always the office folder"*     │
              │                                                              │
              │ Those two buttons **ask the same question twice**: the       │
              │ second one is just "choose the office folder" spelled as a   │
              │ shortcut — and a shortcut for the DEFAULT saves nothing, it  │
              │ just makes someone compare two choices to realize they're    │
              │ nearly the same thing.                                       │
              │                                                              │
              │ ⇒ ONE button, and **the office folder is where the picker    │
              │ already STANDS**. Want it? Hit Done right away, no browsing  │
              │ required. Same number of clicks, one fewer decision — and    │
              │ `cwd` **is always written out**, so `company.yaml` says      │
              │ exactly what will run, with no more "empty means somewhere"  │
              │ case.                                                        │
              └──────────────────────────────────────────────────────────────┘
            */}
            {pane === 'cli' && !cliReady && (
              <>
                <Button size="sm" className="mb-3" onClick={() => setPane('type')}>
                  {t('arm.back')}
                </Button>
                <div className="rounded-lg border border-line p-6 text-center">
                  <div className="flex justify-center text-muted">
                    <ArmIcon kind="cli" className="h-8 w-8" />
                  </div>
                  <div className="mt-3 text-[15px] font-medium">{t('arm.cliCwdTitle')}</div>
                  <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
                    {t('arm.cliCwdBody')}
                  </p>
                  <div className="mt-4 flex justify-center">
                    <Button variant="primary" onClick={() => setBrowsing(true)}>
                      <FolderOpen className="h-4 w-4" />
                      {t('arm.pickFolder')}
                    </Button>
                  </div>
                  <p className="mt-3 text-[11px] text-muted">
                    {t('arm.cliCwdHintBefore')} <b>{t('arm.officeFolder')}</b>{' '}
                    {t('arm.cliCwdHintAfter')}
                  </p>
                </div>
                {reuseList('cli')}
              </>
            )}

            {pane === 'cli' && cliReady && (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      // Back to the folder screen, NOT the type screen: someone
                      // clicking "back" here almost always wants to change the
                      // folder, and whatever they've drafted stays intact.
                      setCliReady(false);
                      setCliJson(null);
                    }}
                  >
                    {t('arm.backToFolder')}
                  </Button>
                  {/* Two directions, ONE source of truth: switching to JSON
                      generates it from the form; switching back reads it back
                      into the form. No two live editors kept in parallel — that's
                      the "two UIs writing the same thing" case that already cost
                      us at skills. */}
                  <Button
                    size="sm"
                    disabled={cliJson !== null && cliMixed}
                    title={
                      cliJson !== null && cliMixed
                        ? t('arm.mixedCwdTip')
                        : undefined
                    }
                    onClick={() => {
                      if (cliJson === null) setCliJson(JSON.stringify(draftToDecl(acts, cliCwd), null, 2));
                      else {
                        try {
                          const back = declToDraft(JSON.parse(cliJson));
                          if (back && !back.mixed) {
                            setActs(back.acts);
                            setCliCwd(back.cwd);
                          }
                        } catch {
                          /* Broken JSON ⇒ keep the form as-is, JsonBox's red box already said so */
                        }
                        setCliJson(null);
                      }
                    }}
                  >
                    {cliJson === null ? t('arm.viewJson') : t('arm.backToForm')}
                  </Button>
                  {/*
                    A SAMPLE THAT RUNS AS-IS — and it fills **whichever pane is
                    open**, not always the form. An "add sample" button that jumps
                    screens forces someone reading JSON to go find where they
                    were standing.
                  */}
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => {
                      const one = [sampleAct(t)];
                      if (cliJson === null) setActs(one);
                      else setCliJson(JSON.stringify(draftToDecl(one, cliCwd), null, 2));
                    }}
                  >
                    {t('arm.fillSample')}
                  </Button>
                </div>

                {/*
                  THE FOLDER BAR — shown at ALL times while editing, even while
                  viewing JSON. It's the only thing on screen that answers *"where
                  does this command run"*, and that answer must not disappear
                  when the view changes.
                */}
                <div className="mb-3 flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1 break-all font-mono text-[12px]">
                    {/*
                      ┌──────────────────────────────────────────────────────┐
                      │ 🔴 AN EMPTY BOX MUST BE NAMED. (bug the user caught, │
                      │ 01/09: *"right now it's just blank so I have no idea │
                      │ what it is"*)                                        │
                      │                                                      │
                      │ The form path never leaves `cwd` empty anymore — but │
                      │ the **paste** path still can: a declaration that     │
                      │ doesn't state `cwd` is valid, and it **really does   │
                      │ run in the office folder**. That state is real ⇒ the │
                      │ screen must say so, not draw a blank box.            │
                      │                                                      │
                      │ ⚠ And this does NOT contradict dropping the "Clear"  │
                      │ button: **showing a state ≠ inviting someone into    │
                      │ that state.** The Clear button was an invitation;    │
                      │ this label is a statement of fact.                   │
                      └──────────────────────────────────────────────────────┘
                    */}
                    {cliMixed ? (
                      <span className="font-sans text-warn">{t('arm.mixedCwd')}</span>
                    ) : shownCwd ? (
                      shownCwd
                    ) : (
                      <span className="font-sans text-muted">{t('arm.defaultCwd')}</span>
                    )}
                  </div>
                  {/*
                    ⚠ ONLY "Change…", NO "Clear" (the user's call, 01/09). Now
                    that the folder screen is down to one button, the form path
                    **always** sets `cwd` — so a "Clear" button here would only
                    invite someone back into the exact state where the screen
                    can't say where the command will run.

                    ⚠ And it DISAPPEARS in JSON mode: there, what's actually
                    saved is the JSON block, so a button that edits `cliCwd`
                    would do nothing. `cwd` gets edited right inside the block.
                  */}
                  {cliJson === null ? (
                    <Button size="sm" onClick={() => setBrowsing(true)}>
                      {t('arm.changeFolder')}
                    </Button>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted">{t('arm.editInJson')}</span>
                  )}
                </div>

                {cliJson !== null ? (
                  <>
                    <JsonBox value={cliJson} onChange={setCliJson} />
                    {/*
                      ⚠ The `mixed` flag must SAY SO, not just grey out a button.
                      A greyed-out button can't explain why it's greyed out.
                    */}
                    {cliMixed && (
                      <p className="mt-1 text-[11px] text-warn">
                        {t('arm.mixedCwdBefore')} <b>{t('arm.mixedCwdBold')}</b>
                        {t('arm.mixedCwdAfter')} <code>cwd</code>.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    {acts.map((a, i) => {
                      const argv = toArgv(a.line);
                      const names = slots(argv);
                      // Does the example match the syntax? `null` = NO — and the
                      // screen must say so, not silently drop the example.
                      const vals = a.example.trim() ? alignExample(argv, toArgv(a.example)) : undefined;
                      const set = (patch: Partial<CliDraft>): void =>
                        setActs((prev) => prev.map((x, j) => (i === j ? { ...x, ...patch } : x)));
                      return (
                        <div key={i} className="rounded-lg border border-line p-3">
                          <div className="mb-2 flex items-center justify-between">
                            {/* "Command", not "Task" (user, 01/09). On this tab
                                the unit the user is drafting IS a command line —
                                calling it a "task" borrows another layer's
                                vocabulary. */}
                            <span className="text-xs font-medium">{t('arm.cliCommandN', { n: i + 1 })}</span>
                            {acts.length > 1 && (
                              <button
                                type="button"
                                className="text-xs text-muted hover:text-danger"
                                onClick={() => setActs((p) => p.filter((_, j) => j !== i))}
                              >
                                {t('arm.cliDrop')}
                              </button>
                            )}
                          </div>

                          {/* ⚠ EVERY FIELD HAS A LABEL, and the label sits **on
                              the same line** as the field (user, 01/09). A
                              placeholder is not a label: it vanishes the moment
                              someone types, so whoever comes back to edit sees
                              an unnamed field. → `Field` */}
                          <Field htmlFor={`cli-say-${i}`} label={t('arm.cliName')}>
                            <Input
                              id={`cli-say-${i}`}
                              placeholder={t('arm.cliNamePlaceholder')}
                              value={a.say}
                              onChange={(e) => set({ say: e.target.value })}
                            />
                            {/*
                              🔴 WARN ON THE **NAME** FIELD, not on some separate
                              "id" field — the user doesn't type an id, they type
                              a name, and the id is generated by `slugId(name)`.
                              Warn where they can actually fix it.

                              ⚠ And the copy talks about **the disease**, not the
                              symptom: two commands with the same id also can't be
                              told apart by the worker via `does`. Auto-appending a
                              `_2` suffix to make it pass just hides the part
                              that's still broken. → `dupIds`
                            */}
                            {a.say.trim() ? (
                              badIds.includes(slugId(a.say)) && (
                                <p className="mt-1 text-[11px] text-danger">
                                  {t('arm.cliDupBefore')}{' '}
                                  <code className="rounded bg-danger-soft px-1">{slugId(a.say)}</code>
                                  {t('arm.cliDupAfter')}
                                </p>
                              )
                            ) : (
                              /* Only turn red when ANOTHER COMMAND is pending, or
                                 the user has already started typing in another
                                 field — a freshly opened form that's already red
                                 scolds someone who hasn't done anything yet. */
                              (acts.length > 1 || a.line.trim() || a.description.trim()) && (
                                <p className="mt-1 text-[11px] text-danger">{t('cliForm.noName')}</p>
                              )
                            )}
                          </Field>

                          <Field
                            htmlFor={`cli-line-${i}`}
                            label={t('arm.cliSyntax')}
                          >
                            <Input
                              id={`cli-line-${i}`}
                              className="font-mono text-[12px]"
                              placeholder={'node count.js --month {month}'}
                              value={a.line}
                              onChange={(e) => set({ line: e.target.value })}
                            />
                            {/* ⭐ ECHO THE ARGV BACK. Splitting a command line is
                                a GUESS, and a guess only gets to exist when the
                                user can SEE its result. → `toArgv` */}
                            {argv.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {argv.map((t, k) => (
                                  <code key={k} className="rounded bg-accent-soft px-1 text-[11px]">
                                    {t}
                                  </code>
                                ))}
                              </div>
                            ) : (
                              (acts.length > 1 || a.say.trim() || a.description.trim()) && (
                                <p className="mt-1 text-[11px] text-danger">{t('cliForm.noLine')}</p>
                              )
                            )}
                          </Field>

                          {/*
                            ┌──────────────────────────────────────────────────┐
                            │ ⭐ THE EXAMPLE FIELD **ALWAYS SHOWS**. (user,    │
                            │ 01/09: *"why does the Sample have an Example but │
                            │ the auto-filled fields don't have an Example     │
                            │ field?"*)                                        │
                            │                                                  │
                            │ The earlier version hid it until the syntax had  │
                            │ a slot, on the logic *"nothing to fill means the │
                            │ example teaches no one"*. That logic is right    │
                            │ **from the model's side** and wrong **from the   │
                            │ user's side**: a field that grows and vanishes on│
                            │ its own follows a rule no one predicts — and it  │
                            │ hides right when someone needs it most, which is │
                            │ before they know they need a slot at all.        │
                            │                                                  │
                            │ ⇒ Always show it, and when there's NO slot yet it│
                            │ **switches roles**: comparing the example against│
                            │ the syntax to **point at where a slot belongs**. │
                            │ The user doesn't have to learn the concept of a  │
                            │ "parameter" first — they paste two real command  │
                            │ lines and the machine points at the difference.  │
                            │ → `ExampleNoSlot`                                │
                            └──────────────────────────────────────────────────┘
                          */}
                          <Field htmlFor={`cli-ex-${i}`} label={t('arm.cliExample')}>
                            <Input
                              id={`cli-ex-${i}`}
                              className="font-mono text-[12px]"
                              placeholder="node count.js --month 8"
                              value={a.example}
                              onChange={(e) => set({ example: e.target.value })}
                            />
                            {/*
                              ⚠ RESTORED 01/09 — the working copy had just
                              removed these two lines, and removing them turns
                              `vals` into a variable nobody reads (red build),
                              but that isn't the main reason:

                              This is the **only visible proof** that the
                              example has been parsed apart — what actually goes
                              into the model's prefix is `name = 8`, not the
                              whole command line. Drop it and whether
                              `alignExample` runs or not looks identical, and the
                              J-5 measurement loses a place to look.
                              → `toArgv`'s rule: a guess must show its result.
                            */}
                            {names.length === 0 ? (
                              <ExampleNoSlot line={a.line} example={a.example} />
                            ) : vals === null ? (
                              <p className="mt-1 text-[11px] text-danger">
                                {t('arm.cliExampleMismatch')}
                              </p>
                            ) : null}
                          </Field>

                          <Field
                            htmlFor={`cli-desc-${i}`}
                            label={t('arm.cliDescription')}
                          >
                            <Textarea
                              id={`cli-desc-${i}`}
                              rows={2}
                              className="text-[13px]"
                              placeholder={t('arm.cliDescriptionPlaceholder')}
                              value={a.description}
                              onChange={(e) => set({ description: e.target.value })}
                            />
                          </Field>

                          {/*
                            ┌──────────────────────────────────────────────────┐
                            │ "READ-ONLY COMMAND" — the user's final call,      │
                            │ 01/09, after my earlier draft spelled it out as a │
                            │ long question.                                    │
                            │                                                   │
                            │ They're right: a short label **reads instantly**  │
                            │ here because it sits on the same line as the      │
                            │ checkbox, in a form where every other line is also│
                            │ `label — field`. A long question breaks that exact│
                            │ rhythm.                                           │
                            │                                                   │
                            │ ⚠ Two things stay as they are: the default is     │
                            │ **unchecked** (`read_only = false`, i.e. "makes   │
                            │ changes" — the safe direction when no one has     │
                            │ answered yet), and it **honestly says it's a      │
                            │ label, not a lock**. After removing the permission│
                            │ tier for CLI (30/08), this field only ever feeds  │
                            │ `annotations`; drawing it as a lock would let the │
                            │ UI lie about something it doesn't enforce.        │
                            │ → [[agentco-safe-default-direction]]              │
                            └──────────────────────────────────────────────────┘
                          */}
                          <Field label={t('arm.cliReadOnly')}>
                            <label className="flex cursor-pointer items-center gap-2 py-2 text-[13px]">
                              <input
                                type="checkbox"
                                checked={a.read_only}
                                onChange={(e) => set({ read_only: e.target.checked })}
                              />
                              <span className="text-muted">{t('arm.cliReadOnlyHint')}</span>
                            </label>
                          </Field>

                          {/*
                            🔴 `fail_when` HAS BEEN TAKEN OUT OF THE FORM (the
                            user asked, 01/09, and their question was right) —
                            see `SPEC-arms §16v`. The field still lives in the
                            declaration and still carries through the form
                            intact (`CliDraft.fail_when`), it's just only
                            editable on the JSON tab. DO NOT rebuild this field
                            here with a placeholder like
                            `ERROR, FAILED, Traceback`: those are exactly the
                            three strings most likely to show up in HEALTHY
                            output.
                          */}
                        </div>
                      );
                    })}
                    <Button size="sm" onClick={() => setActs((p) => [...p, blankAct()])}>
                      {t('arm.cliAdd')}
                    </Button>
                    {/* Cap of 3–8 commands (§16h): each task is a tool definition
                        that sits in the prefix of EVERY turn. Warn, don't block —
                        it's the customer's money. */}
                    {acts.length > 8 && (
                      <p className="text-xs text-muted">
                        {t('arm.cliTooMany')}
                      </p>
                    )}
                  </div>
                )}

                {/* In JSON mode there's no Name/Syntax field to turn red, so this
                    is the ONLY place that says why the button below is greyed
                    out. A greyed-out button can't explain itself. */}
                {cliJson !== null && (badIds.length > 0 || cliBad.length > 0 || cliOut === null) && (
                  <p className="mt-2 text-[11px] text-danger">
                    {cliOut === null
                      ? t('arm.cliJsonBroken')
                      : badIds.length > 0
                        ? t('arm.cliDupIds', { ids: badIds.map((x) => `"${x}"`).join(', ') })
                        : t('arm.cliProblemAt', {
                            n: cliBad[0]!.at + 1,
                            say: cliBad[0]!.say,
                          })}
                  </p>
                )}
                <Button
                  className="mt-2 w-full"
                  variant="primary"
                  disabled={!cliOk}
                  onClick={() => {
                    const decl = cliOut;
                    if (!decl) return;
                    setKeys({});
                    setProbe(null);
                    setErr('');
                    setPick(null);
                    setReuse(null);
                    // Proceed through the EXACT same path as the paste tab — don't
                    // grow a second save path.
                    setPaste(JSON.stringify(decl, null, 2));
                    setStep(2);
                  }}
                >
                  {t('arm.useThisConfig')}
                </Button>
                {/* ONLY command arms — see `kindOf`. Suggesting an HTTP arm here
                    would suggest exactly what this tab refuses to accept as a
                    paste. */}
                {reuseList('cli')}
              </>
            )}

            {/*
              ONE `BrowseDialog` for the whole Commands tab — used for **both**
              the leading folder screen and the "Change…" button on the top bar.
              Two instances would be two folder trees living in parallel, and
              they'd drift apart the second time either one opens.

              ⚠ `start={cliCwd}`: reopen at the EXACT folder currently selected,
              **not** `LAST_DIR` (the user's call, 01/09: *"except for the part
              that reads the default from cache"*). That cache is the memory of
              the FOLDER arm; borrowing it here would open a location with
              nothing to do with the arm being drafted.
            */}
            {pane === 'cli' && (
              <BrowseDialog
                open={browsing}
                start={cliCwd}
                office={officeId}
                onOpenChange={setBrowsing}
                onChange={(v) => {
                  if (!v[0]) return;
                  setCliCwd(v[0]);
                  setCliReady(true);
                  setBrowsing(false);
                }}
              />
            )}

            {pane === 'paste' && (
              <>
                <Button size="sm" className="mb-2" onClick={() => setPane('type')}>
                  {t('arm.back')}
                </Button>
                <JsonBox value={paste} onChange={setPaste} />
                {/*
                  ┌────────────────────────────────────────────────────────────┐
                  │ PASTED INTO THE WRONG TAB ⇒ POINT THE WAY, AND CARRY THE   │
                  │ CONTENT OVER. (added 01/09)                                │
                  │                                                            │
                  │ Same mechanism as `ProbeReport(hasLoginButton, match)`,    │
                  │ 31/08: recognize what was just pasted and point at the     │
                  │ right door, instead of letting them click Test → fail →    │
                  │ understand nothing.                                        │
                  │                                                            │
                  │ ⚠ A button that CARRIES THEM OVER along with the content,  │
                  │ not a sentence telling them to go paste it again — copy    │
                  │ that makes someone paste a second time is worth exactly    │
                  │ as much as saying nothing. And this rule lives in the UI — │
                  │ the core still accepts a CLI declaration from every path.  │
                  │ → `cli-arm.ts`                                             │
                  └────────────────────────────────────────────────────────────┘
                */}
                {isCliPaste(paste) ? (
                  <div className="mt-1 rounded-md border border-warn/40 p-2">
                    <p className="text-xs">
                      {t('arm.pasteIsCliBefore')} <b>{t('arm.pasteIsCliBold')}</b>
                      {t('arm.pasteIsCliAfter')}
                    </p>
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        /*
                          ┌──────────────────────────────────────────────────┐
                          │ GO STRAIGHT TO THE **JSON TAB**, not the form.   │
                          │ (user, 01/09: *"with the new per-arm folder, the │
                          │ paste-json-to-cli conversion no longer holds up"*│
                          │ — and they're right)                             │
                          │                                                  │
                          │ As of today the folder belongs to the **whole    │
                          │ arm**, so a hand-written declaration that sets a │
                          │ different `cwd` per command **can't be read back │
                          │ into the form**. Dumping it into the form would  │
                          │ silently relocate where n−1 commands run.        │
                          │                                                  │
                          │ ⇒ Land in the **JSON box of the Commands tab**:  │
                          │ verbatim to verbatim, with no transformation in  │
                          │ between. If the user wants to go back to the form│
                          │ they click for it themselves — and by then that  │
                          │ button is already locked if the `cwd`s disagree. │
                          └──────────────────────────────────────────────────┘
                        */
                        const back = declToDraft(safeJson(paste));
                        setActs(back && !back.mixed ? back.acts : [blankAct()]);
                        setCliCwd(back && !back.mixed ? back.cwd : '');
                        setCliJson(paste);
                        setCliReady(true);
                        setPane('cli');
                      }}
                    >
                      {t('arm.openCliTab')}
                    </Button>
                  </div>
                ) : extraServers.length > 0 ? (
                  /*
                    ┌──────────────────────────────────────────────────────────┐
                    │ 🔴 A BLOCK WITH MULTIPLE SERVERS — we only wire up THE    │
                    │ FIRST ONE. (user asked, 01/09: *"check whether custom mcp │
                    │ is leaking anything"* — it was, and this is where.)       │
                    │                                                           │
                    │ `parsePaste` takes `Object.entries(mcpServers)[0]` and    │
                    │ drops the rest **without a single word about it**. Many   │
                    │ vendors' READMEs list 2–3 servers in one block, so this   │
                    │ isn't a rare case: the user clicks Done, sees ✓, and loses│
                    │ an arm with **zero symptoms**.                            │
                    │                                                           │
                    │ ⚠ NOT a block — wiring up the first one is correct and    │
                    │ useful behavior. What's missing is just **saying so**:    │
                    │ which one we took, and how to wire up the others. Same    │
                    │ rule as `ProbeReport`: if it fails silently, the UI must  │
                    │ not fail silently along with it.                          │
                    └──────────────────────────────────────────────────────────┘
                  */
                  <p className="mt-1 text-xs text-warn">
                    {t('arm.multiServerBefore', { n: extraServers.length + 1 })}{' '}
                    <b>{firstServer}</b> {t('arm.multiServerMid')}
                    {' '}
                    {extraServers.map((n) => <code key={n} className="mx-0.5 rounded bg-accent-soft px-1">{n}</code>)}
                    {' '}
                    {t('arm.multiServerAfter')}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    {t('arm.pasteHintBefore')} <code>{'{"mcpServers": {...}}'}</code>{' '}
                    {t('arm.pasteHintAfter')}
                  </p>
                )}
                <Button
                  className="mt-2 w-full"
                  disabled={!paste.trim() || isCliPaste(paste)}
                  onClick={() => {
                    // ⚠ NO `resetConfig()` here: it would also clear `paste`, and
                    // `paste` is exactly what the user just typed to proceed.
                    // This is the only path where the config is entered RIGHT AT
                    // step 1.
                    setKeys({});
                    setProbe(null);
                    setErr('');
                    setPick(null);
                    setReuse(null);
                    setStep(2);
                  }}
                >
                  {t('arm.useThisConfig')}
                </Button>
                {/*
                  🔴 MISSING FROM THE START — the other two tabs have it, this one
                  doesn't. (the user caught it, 31/08)

                  The 26/08 rule (comment block at `reuseList`) settled it:
                  *"entering a specific type filters by that type"* — and all
                  three tabs are supposed to carry a reuse list for their own
                  type. `catalog` has `reuseList('service')`, `files`'s step 2 has
                  `reuseList('files')`, and `paste` had **no line at all**. Not a
                  decision, just an oversight.

                  The consequence is worse on exactly this tab: a custom-pasted
                  arm is the **only** type with no catalog card to click back
                  onto, so without this list its only reuse path is **pasting the
                  same config in by hand again** — a duplicate, exactly what §6i-bis
                  went to the trouble of removing.
                */}
                {reuseList('custom')}
              </>
            )}

            {/* Step 1 also needs somewhere to say an error: the "delete for good"
                button lives here, and the server can refuse it (someone still
                holds the item). Swallowing that message means clicking it and
                seeing nothing happen. */}
            {err && <p className="mt-2 text-xs text-danger">{err}</p>}
          </div>
        )}

        {/* ─────────────────────────────────── Step 2 · Keys & Test now */}
        {step === 2 && (
          <div className="max-h-[52vh] overflow-y-auto">
            {/*
              ⚠ THE NAME HERE IS READ-ONLY — the edit field was REMOVED (the user
              caught it: "it's not even editable here, tested it").

              The old field genuinely lied: `addArm` keeps the label already in
              the shared registry if that entry existed before (*"reconnecting
              something that was already named means that name belongs to
              them"*), so typing a new name during a RECONNECT was silently
              ignored.

              Fixed toward the more honest direction: the name at creation time
              is AUTO-GENERATED, and renaming is its own action on the detail
              panel — where it actually takes effect, and where the user pointed
              us from the start (*"not at the creation step but afterward"*).
            */}
            {label && (
              <div className="mb-3 rounded-md border border-line px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted">{t('arm.connectionName')}</div>
                <div className="mt-0.5 break-all text-[13px] font-medium">{label}</div>
                {/*
                  ┌──────────────────────────────────────────────────────────┐
                  │ STATE THE WORKSPACE + PERMISSION LEVEL RIGHT HERE.       │
                  │ (user, 26/08)                                            │
                  │                                                          │
                  │   *"at minimum it should show the workspace name, the    │
                  │   current permission"*                                   │
                  │                                                          │
                  │ This screen used to just say "Notion" — correct but      │
                  │ useless once the user has three workspaces. Both pieces  │
                  │ come from the screen's own state (`account`, `tier`), so │
                  │ they **always match** exactly what the Done button is    │
                  │ about to send.                                           │
                  │                                                          │
                  │ ⚠ ANSWERING THE USER'S WORRY — *"is this pretending to   │
                  │ be an edit again?"*: NO. This is the **creation** screen,│
                  │ so the permission level here is a real choice. What can't│
                  │ be edited is the level of an arm that's ALREADY connected│
                  │ — and changing that still means connecting a new one and │
                  │ pulling the old one (§6j). Two different screens, two    │
                  │ different answers.                                       │
                  └──────────────────────────────────────────────────────────┘
                */}
                {(pickedAccount || (pick?.tiered && probe?.status === 'connected')) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {pickedAccount && (
                      <span className="rounded bg-line/70 px-1.5 py-0.5 text-muted">
                        {pickedAccount.label ?? pickedAccount.name}
                      </span>
                    )}
                    {pick?.tiered && probe?.status === 'connected' && (
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          tier === 'full' ? 'bg-danger-soft text-danger' : 'bg-line/70 text-muted'
                        }`}
                      >
                        {t(LEVEL_SAY[tier])}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {pick?.folders && (
              <>
                <Label>{pick.folders.label}</Label>
                <FolderPicker
                  busy={testing}
                  chosen={folderList()}
                  onChange={(list) => {
                    /*
                      ┌──────────────────────────────────────────────────────┐
                      │ FLAG A CLASH RIGHT AT SELECTION, NOT AT SAVE TIME.   │
                      │                                                      │
                      │ The server-side check is still the REAL gate (a      │
                      │ client can be bypassed), but firing it only at the   │
                      │ end means the user has already gone through: select  │
                      │ → wait ~20s for the test → hand it to someone → click│
                      │ Done → and ONLY THEN get rejected. Four wasted steps │
                      │ for something knowable at step one.                  │
                      │                                                      │
                      │ ⚠ Only compare against arms ALREADY IN USE AT THIS   │
                      │ OFFICE — a different office is an independent clone, │
                      │ and that's fine.                                     │
                      └──────────────────────────────────────────────────────┘
                    */
                    const dup = list[0] ? clashingArm(list[0], installed, officeId) : undefined;
                    if (dup) {
                      setErr(t('arm.folderClash'));
                      return;
                    }
                    setErr('');
                    setFolders(list.join('\n'));
                    // Changing the folder means the old Test result describes a
                    // DIFFERENT config. Keeping the ✓ would let Save go through
                    // on something nobody has tested.
                    setProbe(null);
                    /*
                      ┌──────────────────────────────────────────────────────┐
                      │ THE LABEL IS TEXT FOR A HUMAN — NO SLUG, KEEP UNICODE │
                      │ AS-IS                                                 │
                      │                                                       │
                      │ The earlier version ran `leaf` through the slugger    │
                      │ and used the slug as a GATE (`if (slug) setLabel      │
                      │ (leaf)`). For non-Latin script — 文档 · 회계 ·        │
                      │ документы — the slug comes out EMPTY, so the label    │
                      │ never gets set, and the node shows the raw HASH       │
                      │ `a5e5e1306bf` on the diagram instead.                 │
                      │                                                       │
                      │ Same family as `slugId` returning empty for every     │
                      │ non-Latin script (SESSIONS_MEMORY ⑳) — a normalizer   │
                      │ written for Vietnamese that LOOKS like it was written │
                      │ for every language.                                   │
                      │                                                       │
                      │ No slug is needed here at all: the label isn't a      │
                      │ folder name, isn't a yaml key, isn't an id — identity │
                      │ is already the hash, and the hash is always `a`+hex   │
                      │ regardless of what script the path is written in.     │
                      └──────────────────────────────────────────────────────┘
                    */
                    const leaf = list[0]?.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.trim() ?? '';
                    // A drive root (`D:\`) has no leaf name — fall back to the
                    // full path instead of leaving it empty, since empty is
                    // exactly what leaves the node carrying the hash.
                    setLabel(leaf || list[0] || t('arm.folderFallbackLabel'));
                  }}
                />
                {/*
                  ┌────────────────────────────────────────────────────────────┐
                  │ ONE CONNECTION = ONE FOLDER. (the user's call, 23/08)      │
                  │                                                            │
                  │ The `filesystem` server DOES ACCEPT multiple roots (we     │
                  │ measured it), but we deliberately allow only one, and the  │
                  │ reason is LEAST PRIVILEGE: merging A+B into one grant means│
                  │ a worker needing only A also gets B, with no way to split  │
                  │ them apart later short of rebuilding from scratch.         │
                  │                                                            │
                  │ In exchange: a worker that needs three folders pays ~3×    │
                  │ tokens. That's a VISIBLE cost (shown right below), and the │
                  │ natural way out is picking a shared PARENT folder — a      │
                  │ decision the user can weigh themselves, unlike a constraint│
                  │ they can't undo.                                           │
                  └────────────────────────────────────────────────────────────┘
                */}
                <p className="mt-1.5 text-xs text-muted">{pick.folders.help}</p>
                <p className="mt-1 text-xs text-muted">
                  {t('arm.oneFolderNote')}
                </p>
                {/*
                  The reuse list sits at the FOOT of step 2, not on its own
                  screen — see the comment block on the "Local files" card. This
                  is the only place a folder arm can be reused after dropping the
                  intermediate screen, and removing it too would lose a path that
                  already has data sitting in the registry.
                */}
                {reuseList('files')}
              </>
            )}

            {/*
              Key fields are GENERATED from the catalog — the user never types a
              variable name. That name can't be inferred from the protocol: it's
              needed BEFORE the handshake. → §5c
            */}
            {pick?.secrets.map((s) => (
              <div key={s.name} className="mt-3">
                <Label htmlFor={`k-${s.name}`}>{s.label}</Label>
                <Input
                  id={`k-${s.name}`}
                  type="password"
                  value={keys[s.name] ?? ''}
                  onChange={(e) => setKeys((k) => ({ ...k, [s.name]: e.target.value }))}
                />
                <p className="mt-1 text-xs text-muted">↳ {s.help}</p>
              </div>
            ))}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ SIGN IN — 0 keys typed, and the button lives HERE (the web   │
              │ UI).                                                         │
              │                                                              │
              │ The browser you're sitting in already has a Notion session;  │
              │ the daemon knows nothing about it. That's why this button    │
              │ lives in the UI instead of a CLI command that opens a browser│
              │ on its behalf. (lesson from 24/08)                           │
              └──────────────────────────────────────────────────────────────┘
            */}
            {pick?.needsLogin && (
              <div className="mt-3 rounded-md border border-line px-3 py-3">
                {accounts.length === 0 ? (
                  <>
                    <div className="text-[13px] font-medium">{t('arm.noWorkspaceTitle')}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">
                      {t('arm.noWorkspaceBefore')} <b>Allow</b>
                      {t('arm.noWorkspaceMid')} <b>{t('arm.noWorkspaceBold')}</b>
                    </p>
                  </>
                ) : (
                  <>
                    {/*
                      "Workspace", not "account" — the user pointed this out,
                      26/08, and they're right: Notion's architecture is **1
                      account ⇄ N workspaces**, and each OAuth grant attaches to
                      **one workspace** (the token carries `workspace_id`/
                      `workspace_name`). Calling it "account" uses our vocabulary
                      for their concept, and leaves the user to translate it
                      themselves.
                    */}
                    <div className="text-[11px] uppercase tracking-wide text-muted">{t('arm.useWorkspace')}</div>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {accounts.map((a) => (
                        <div key={a.name} className="flex items-center gap-1">
                          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent">
                            <input
                              type="radio"
                              name="oauth-account"
                              checked={account === a.name}
                              // Switching workspace ⇒ CLEAR everything downstream
                              // (tier, task group, test, install). → `chooseAccount`
                              onChange={() => chooseAccount(a.name)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{a.label ?? a.name}</span>
                              {/*
                                A dead key ⇒ SAY SO RIGHT HERE, next to the name.
                                Without it, the only symptom is a silent 401 on
                                the arm while some worker is mid-task — far from
                                the cause, and a 401 says "wrong key" rather than
                                "dead key, click Sign in". → §5m, the lifecycle
                                layer.

                                ⚠ It NAMES NO BUTTON any more (fixed 09/04). The
                                old copy said *"press Sign in to reconnect"* while
                                the only button on screen read "Sign in another
                                account" — copy pointing at a control that does
                                not exist. The button now sits on this very row,
                                close enough that the sentence does not have to
                                give directions to it.
                              */}
                              {a.dead && (
                                <span className="mt-0.5 block text-[11px] text-danger">
                                  {t('arm.workspaceExpired')}
                                </span>
                              )}
                            </span>
                          </label>
                          {/*
                            ┌────────────────────────────────────────────────┐
                            │ RECONNECT — ON THE DEAD ROW, next to the bin.  │
                            │ (user's call, 09/04)                           │
                            │                                                │
                            │ The red line under the name used to say *"press│
                            │ Sign in to reconnect"*, and there was no such   │
                            │ button anywhere: with accounts already present  │
                            │ the only button on the screen reads **"Sign in  │
                            │ another account"**. So the copy sent people     │
                            │ looking for a control that did not exist, and   │
                            │ the one they did find promised a DUPLICATE.     │
                            │ → [[agentco-wrong-door-errors]]                │
                            │                                                │
                            │ Shown ONLY on a dead row: a live account has    │
                            │ nothing to reconnect, and a button that does    │
                            │ nothing 99% of the time teaches people to stop  │
                            │ reading the row.                               │
                            │                                                │
                            │ It calls the SAME `login()` as the main button. │
                            │ Signing in as that same user lands on the same  │
                            │ identity seed ⇒ the same account NAME ⇒ the     │
                            │ record is overwritten and `dead` disappears     │
                            │ with it. No "repair" path to build, and every   │
                            │ arm holding the credential recovers at once —   │
                            │ `accountName` is what makes that true. → §5h·7k │
                            └────────────────────────────────────────────────┘
                          */}
                          {a.dead && (
                            <button
                              type="button"
                              disabled={logging}
                              title={t('arm.workspaceReconnectTip', { label: a.label ?? a.name })}
                              aria-label={t('arm.workspaceReconnectTip', { label: a.label ?? a.name })}
                              className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => {
                                // Remember WHICH row this was for — the service
                                // decides who actually authorises, and the two
                                // can differ. → `reconnecting`
                                setReconnecting(a.name);
                                void login();
                              }}
                            >
                              {logging ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                t('arm.signInAgain')
                              )}
                            </button>
                          )}
                          {/*
                            ⚠ STILL IN USE BY AN ARM ⇒ LOCK THE BUTTON, with a
                            reason — don't offer a choice that's guaranteed to be
                            rejected (§6e). And it buys something else: once
                            every click is guaranteed to succeed, **optimistic UI
                            becomes honest** — see `dropNow`. Optimism that
                            frequently has to roll back is worse than a stall: the
                            item vanishes and then reappears with an error.
                          */}
                          <button
                            type="button"
                            disabled={a.usedBy.length > 0}
                            title={
                              a.usedBy.length
                                ? t('arm.workspaceInUse', { who: a.usedBy.join(', ') })
                                : t('arm.workspaceDropTip')
                            }
                            aria-label={t('arm.workspaceDropAria', { label: a.label ?? a.name })}
                            className="shrink-0 rounded p-1.5 text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted"
                            onClick={() => setDropWs(a)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {/*
                  ┌──────────────────────────────────────────────────────────┐
                  │ 🔴 THE BUTTON MUST NOT BE LOCKED WHILE WAITING. (bug the │
                  │ user reported, 26/08)                                    │
                  │                                                          │
                  │ *"because the flow didn't succeed, it just spins         │
                  │  forever… you have to hit F5 to clear it, or should there│
                  │  be a small X on the right?"*                            │
                  │                                                          │
                  │ The old version had `disabled={logging}` and only cleared│
                  │ the wait once SSE reported SUCCESS. But when the OAuth   │
                  │ flow fails on the service's side, **no event ever        │
                  │ arrives** — Notion returns an error in the other tab,    │
                  │ while this tab waits forever. We'd made the wait state   │
                  │ depend on a signal **that only exists on the success     │
                  │ branch**.                                                │
                  │                                                          │
                  │ ⇒ Two ways out, neither needs F5: click the button again │
                  │ (opens a new attempt, new `state`) or ✕ to stop waiting. │
                  │ The user's instinct was right — ✕ is what people go      │
                  │ looking for.                                             │
                  └──────────────────────────────────────────────────────────┘
                */}
                {/* Device code: three steps, a clock, a copy button ⇒ split into its own file. */}
                {device && (
                  <DeviceCode key={device.state} name={pick.name} device={device} now={now} />
                )}

                <div className="mt-2 flex gap-1.5">
                  <Button className="flex-1" onClick={() => void login()}>
                    {logging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {logging
                      ? device
                        ? t('arm.waitingApproval')
                        : t('arm.waitingClickAgain')
                      : accounts.length
                        ? pick.deviceLogin
                          ? t('arm.addAnotherAccount')
                          : t('arm.addAnotherWorkspace')
                        : t('arm.signInWith', { name: pick.name })}
                  </Button>
                  {logging && (
                    <Button
                      aria-label={t('arm.stopWaiting')}
                      title={t('arm.stopWaiting')}
                      onClick={() => {
                        // Clear BOTH: leaving `device` set would let the polling
                        // loop keep running right after the user just said stop —
                        // exactly the "the system lies about its own state" bug.
                        setDevice(null);
                        setLogging(false);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {logging && !device && (
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    {t('arm.tabHint')}
                  </p>
                )}

                {/* The customer's client_id field: specific to the device-code flow ⇒ split into its own file. */}
                {pick.deviceLogin && (
                  <OwnClient
                    name={pick.name}
                    own={own}
                    value={clientId}
                    onChange={setClientId}
                    onSave={() => void saveClientId()}
                  />
                )}
              </div>
            )}

            {/*
              The scope block + install-scan block: brand-specific ⇒ live in
              `components/arm/`.

              ⚠ `!logging` — hide both WHILE signing in. They describe the
              **currently selected account**, and mid-login the currently
              selected account is about to stop being the one the user cares
              about. A block that's correct-about-the-past sitting mid-screen is
              harder to catch than a block that's simply absent. (user, 28/08)
            */}
            {pick?.scope && accounts.length > 0 && !logging && (
              <ScopeBox name={pick.name} scope={pick.scope} />
            )}
            {pick?.repoScan && accounts.length > 0 && account && !logging && (
              <RepoScan
                name={pick.name}
                scope={pick.scope}
                scan={scan}
                scanning={scanning}
                anyway={anyway}
                onAnyway={setAnyway}
                onRecheck={() => void runScan()}
              />
            )}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ THREE PERMISSION TIERS — and the **TASK COUNT** is what makes│
              │ it honest.                                                   │
              │                                                              │
              │ The tier list comes from the SERVER (`probe.tiers`), not     │
              │ inferred here: the rule *"only show if it ADDS ≥1 task versus│
              │ the tier below"* has a subtle edge case (an all-read-tool    │
              │ server ⇒ all three tiers equal ⇒ the lower two are noise),   │
              │ and building a second copy of that rule means building a     │
              │ copy that will forget a condition. → §6j                     │
              │                                                              │
              │ Only ONE tier left ⇒ skip the picker: a single option is     │
              │ not a question.                                              │
              └──────────────────────────────────────────────────────────────┘
            */}
            {pick?.tiered && probe?.status === 'connected' && (probe.tiers?.length ?? 0) > 1 && (
              <div className="mt-3">
                <Label>{t('arm.tierLabel')}</Label>
                <div className="mt-1 flex flex-col gap-1">
                  {/* `row`, not `t` — that name is the translator now. */}
                  {probe.tiers!.map((row) => (
                    <label
                      key={row.tier}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent"
                    >
                      <input
                        type="radio"
                        name="tier"
                        checked={tier === row.tier}
                        onChange={() => setTier(row.tier)}
                      />
                      <span className="flex-1">{t(TIER_SAY[row.tier].name)}</span>
                      <span className="shrink-0 tabular-nums text-[11px] text-muted">
                        {plural('inspector.toolCount', row.count)}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {/*
                    ⚠ THE CATALOG ENTRY'S COPY WINS OVER THE DEFAULT — and only in
                    the HELP text. The tier name (`TIER_SAY[t].name` above) does
                    NOT allow overriding: it's shared vocabulary so the user can
                    compare two arms against each other.

                    This exists because the `add` tier's default copy
                    (*"Can create new pages/items…"*) is wrong for Linear:
                    `save_issue` is an upsert, so reopening an issue falls under
                    `full`. Overpromising is worse than overwarning (§11a-bis).
                    → `core/catalog.ts §tierSay`
                  */}
                  {pick?.tierSay?.[tier] ?? t(TIER_SAY[tier].help)}
                  {/*
                    ⚠ ATTRIBUTE THE CLAIM TO WHO ACTUALLY SAID IT. We write "the
                    server declares", not "this arm is read-only" — we can NOT
                    guarantee the latter. `annotations` is **the server's own
                    claim**; if it declares carelessly or wrongly, no client can
                    detect that. This sentence stays true even when that
                    happens. → §6j
                  */}
                  {' '}
                  <span className="text-muted">
                    {t('arm.tierDeclared', { server: probe.serverName ?? 'Server' })}
                  </span>
                </p>
                {/*
                  ⚠ STATE THE LIMIT OF THE NUMBER ITSELF. The test runs **without
                  the tier fence applied** (if it did, this picker would never
                  show at all — `catalog.ts §serverFenced`), so the measured token
                  count is a **ceiling**. At a lower tier, the server strips write
                  tools from the start ⇒ it costs less.

                  Staying silent here would mean the user reads an accurate number
                  for a config they **did not choose** — and it skews toward
                  overwarning, i.e. toward talking them out of something they
                  need. → §9b
                */}
                {pick.serverFence && tier !== 'full' && (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    {t('arm.serverFenceBefore')} <b>{t('arm.serverFenceBold')}</b>
                    {t('arm.serverFenceMid', { name: pick.name })}{' '}
                    <b>{t('arm.serverFenceBold2')}</b>.
                  </p>
                )}
              </div>
            )}
            {pick?.tiered && probe?.status === 'connected' && probe.tiers?.length === 1 && (
              <p className="mt-3 rounded-md border border-line px-3 py-2 text-[13px]">
                {t('arm.oneTierBefore')}{' '}
                <b>{t(TIER_SAY[probe.tiers[0]!.tier].name).toLowerCase()}</b>{' '}
                {t('arm.oneTierAfter')} {plural('inspector.toolCount', probe.tiers[0]!.count)}.
              </p>
            )}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ TASK GROUPS — only asked at the FULL-ACCESS tier. (the user's│
              │ call, 27/08)                                                 │
              │                                                              │
              │ At the read-only tier this screen shows NOTHING, and the     │
              │ config falls back to the catalog's default-enabled groups.   │
              │ That's the entire point of *"read-only shouldn't need any    │
              │ picking"*: a cheap, consequence-free tier shouldn't tax the  │
              │ user's attention.                                            │
              │                                                              │
              │ 🔴 THE ACCOMPANYING NUMBER IS MEASURED, NOT SHIPPED AS A     │
              │ CONSTANT. Read from `probe.tools.length` / `probe.tokens`,   │
              │ i.e. from a real handshake with exactly the group set that's │
              │ currently checked. Shipping a constant measured on 26/08 into│
              │ the catalog means it **silently goes stale** once the vendor │
              │ adds a tool — the same "hand-typed snapshot" class of problem│
              │ that `catalog.ts §readOnly` just removed. The number here can│
              │ show up LATE (after clicking Test) — late-but-correct beats  │
              │ immediate-but-made-up.                                       │
              │                                                              │
              │ Change a checkbox ⇒ DISCARD the old test result: it describes│
              │ a different group set. Same discipline as `runRef` and the   │
              │ folder picker. → §9b                                         │
              └──────────────────────────────────────────────────────────────┘
            */}
            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ THE "HOW IT RUNS" CHECKBOXES — asked at EVERY tier, unlike    │
              │ task groups.                                                  │
              │                                                               │
              │ The rule *"a question only carries weight when it's RECORDED"*│
              │ (27/08) applies to task groups because they're about          │
              │ **permission**. These two checkboxes are about **how it runs**│
              │ — whether a window pops up, whether login is remembered — so  │
              │ every tier has to ask.                                        │
              │                                                               │
              │ Change a checkbox ⇒ DISCARD the old test result: it describes │
              │ a different config.                                           │
              └──────────────────────────────────────────────────────────────┘
            */}
            {!!pick?.options?.length && (
              <div className="mt-3">
                <Label>{t('arm.howItRuns')}</Label>
                <div className="mt-1 flex flex-col gap-1">
                  {pick.options
                    // Hide options only usable on the same machine. Showing one
                    // and letting the server reject it would offer a choice
                    // that's GUARANTEED WRONG — same logic as filtering office
                    // entries right at the top of this file.
                    .filter((o) => sameMachine || !o.loopbackOnly)
                    .map((o) => (
                      <label
                        key={o.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent"
                      >
                        <input
                          className="mt-0.5"
                          type="checkbox"
                          checked={options.includes(o.id)}
                          onChange={(e) => {
                            setOptions((cur) =>
                              e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id),
                            );
                            setProbe(null);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block">{o.label}</span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                            {o.help}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
                {!sameMachine && pick.options.some((o) => o.loopbackOnly) && (
                  /*
                    Say so instead of silently dropping an option: a choice that
                    vanishes with no explanation is a puzzle, and the user will go
                    looking for it somewhere else.
                  */
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    {t('arm.remoteHiddenOption')}
                  </p>
                )}
              </div>
            )}
            {needGroups() && (
              <div className="mt-3">
                <Label>{t('arm.groupsLabel')}</Label>
                <div className="mt-1 flex flex-col gap-1">
                  {pick!.groups!.map((g) => (
                    <label
                      key={g.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent"
                    >
                      <input
                        className="mt-0.5"
                        type="checkbox"
                        checked={groups.includes(g.id)}
                        onChange={(e) => {
                          setGroups((cur) =>
                            e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id),
                          );
                          setProbe(null);
                        }}
                      />
                      {/*
                        THE VENDOR'S NAME + A SENTENCE ABOUT WHAT IT CAN DO.
                        (user, 28/08)

                        Don't replace the name with a description: the name is
                        what the user can look up in the vendor's docs, the
                        description is what helps them decide. Merging both roles
                        into one string loses both — exactly the case where the
                        `context` label got translated into *"Knows who I am,
                        which repo"*, both confusing and overpromising its
                        scope. → `catalog.ts §ArmGroup`
                      */}
                      <span className="min-w-0 flex-1">
                        <span className="block">{g.label}</span>
                        {g.help && (
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                            {g.help}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {groups.length === 0 ? (
                  /*
                    An arm with 0 tasks is a silently broken arm — say so here
                    instead of leaving the Next button greyed out with no
                    explanation. A greyed-out button with no reason is a puzzle,
                    not a refusal. → B-3
                  */
                  <p className="mt-1.5 text-xs text-danger">
                    {t('arm.groupsRequired')}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    {probe?.status === 'connected' ? (
                      <>
                        {t('arm.grantingBefore')}{' '}
                        <b>{plural('inspector.toolCount', probe.tools.length)}</b>
                        {probe.tokens ? (
                          <>
                            {' · '}
                            <b className="tabular-nums">
                              {t('arm.tokensPerTurn', { n: formatNumber(probe.tokens) })}
                            </b>{' '}
                            {t('arm.grantingAfter')}
                          </>
                        ) : null}
                        .
                      </>
                    ) : (
                      <>{t('arm.grantingUnknown')}</>
                    )}
                  </p>
                )}
              </div>
            )}

            {/*
              ⚠ REMOVED here (afternoon of 27/08): the `All repos / Only these
              repos` radio — agentco's own repo fence. It worked and had a test,
              but the user was right to reject it: repo scope is a
              **GitHub-account-level** asset, and a second fence stacked on top
              only buys per-arm narrowing at the price of hand-typing it and
              reconnecting to change it. → `SPEC-arms.md` §5h·7m

              What's left is the TEST box right below. Looks similar, does a
              completely different job.
            */}

            {/*
              The CUSTOM-PASTE path also needs to accept keys — see
              `pastedKeys`. The label here is the variable name itself, and
              that's correct: the user just TYPED it themselves into the config
              block, so it's their vocabulary, not ours.
            */}
            {pastedKeys().map((name) => (
              <div key={name} className="mt-3">
                <Label htmlFor={`k-${name}`}>{name}</Label>
                <Input
                  id={`k-${name}`}
                  type="password"
                  value={keys[name] ?? ''}
                  onChange={(e) => setKeys((k) => ({ ...k, [name]: e.target.value }))}
                />
                <p className="mt-1 text-xs text-muted">
                  {t('arm.envPlaceholderBefore')} <code>{'${' + name + '}'}</code>
                  {t('arm.envPlaceholderAfter')} <code>company.yaml</code>.
                </p>
              </div>
            ))}

            {/*
              REUSE: no field to fill in, and we have to SAY WHY — a blank
              "Setup" step looks like the app forgot to render something.

              ⚠ ONE SENTENCE, and that is the whole decision (user, 09/04). The
              earlier copy also explained that keys sit at company level, told
              the user to press Test, and printed the key NAME in use — four
              facts stacked on a step where there is nothing to do. The name in
              particular (`NOTION_OAUTH_AFAFBCD6`) answers a question nobody
              asked here and reads like something that needs acting on. What
              this box is for is removing the *"did it forget to render?"*
              doubt, and one sentence does that.
            */}
            {reuse && !reuse.keyDead && (
              <div className="mt-3 rounded-md border border-line bg-accent-soft/30 px-3 py-2 text-[13px]">
                <div className="font-medium">{t('arm.reuseNothingTitle')}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted">{t('arm.reuseBody')}</div>
              </div>
            )}

            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │ THE CREDENTIAL IS DEAD ⇒ SAY IT HERE, AND PUT THE DOOR HERE  │
              │ TOO. (real case 09/03, the user's report 09/04)              │
              │                                                              │
              │ What happened: three accounts were marked dead on 09/03; on  │
              │ 09/04 this screen still said *"nothing to fill in again"* and│
              │ invited the user to press Try it, which came back with the   │
              │ SDK's raw English 401. The system had KNOWN for a day. It    │
              │ just never said so at the spot the person was standing.      │
              │                                                              │
              │ ⚠ It REPLACES the reuse notice rather than sitting under it: │
              │ *"nothing to fill in again"* is FALSE once the key is dead — │
              │ there is exactly one thing to do, and it is a sign-in.       │
              │                                                              │
              │ The button does NOT start a second sign-in flow: it hands    │
              │ over to the catalogue path, which already owns every state   │
              │ this needs (device code, waiting, ✕ to stop, reload on SSE). │
              │ Same five lines the services grid uses.                      │
              │ → [[agentco-count-mechanisms]]                               │
              │                                                              │
              │ No catalogue entry (a hand-pasted arm) ⇒ NO button, because  │
              │ `oauthStart` takes a `catalogId` and there is no door to     │
              │ point at. Promising one would be the wrong-door error in its │
              │ worst form: not vague, but WRONG. → the `needs-auth` panel   │
              └──────────────────────────────────────────────────────────────┘
            */}
            {reuse?.keyDead && (
              <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[13px]">
                <div className="flex items-center gap-1.5 font-medium">
                  <TriangleAlert className="h-4 w-4 text-danger" />
                  {t('arm.keyDeadTitle')}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-muted">
                  {t('arm.keyDeadBody', { who: reuse.keyDead })}
                </div>
                {(() => {
                  const entry = catalog.find((c) => c.id === reuse.catalog);
                  if (!entry) return null;
                  return (
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        /**
                          ⚠ NAVIGATE ONLY — the sign-in is NOT started here.
                          (user's call, 09/04, after trying the version that did)

                          Opening a service's authorisation window is not ours
                          to trigger on someone's behalf: the list they land on
                          is also where they may decide to sign in as a
                          DIFFERENT account, and a flow that has already started
                          takes that choice away. The row they came for carries
                          its own Sign in again button, and the ordinary
                          "another account" button is right there beside it.
                        */
                        resetConfig();
                        setPick(entry);
                        setReuse(null);
                        setLabel(entry.name);
                        setStep(2);
                      }}
                    >
                      {t('arm.signInAgain')}
                    </Button>
                  );
                })()}
              </div>
            )}

            {/*
              ⚠ KEEP THE TEST, DROP THE BUTTON. (user: *"can we drop the Test
              button for folders, I'm fairly sure it's deterministic"*)

              The config really is deterministic, but what fails is NOT the
              config — it's the ENVIRONMENT, and we've measured all three: the
              machine has no `npx` · can't reach npm (a corporate proxy) · the
              folder isn't readable. All three yield `failed`, and all three are
              things a non-technical person can't diagnose on their own.

              A stronger reason: the first run has to DOWNLOAD THE PACKAGE,
              ~22 seconds. Removing the test doesn't make that wait disappear —
              it just **moves it to the middle of a task already running**, once
              the user has walked away. Testing here puts it back at the moment
              they're still present and can actually do something.

              ⇒ Drop one click, keep the check: the test now runs
              AUTOMATICALLY as soon as a folder is chosen. The button only
              remains for the "custom paste" path and for retrying.
            */}
            {(!pick?.folders || probe?.status === 'failed') && (
              <Button className="mt-4 w-full" onClick={() => void test()} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {testing ? t('arm.connecting') : probe ? t('arm.tryAgain') : t('arm.tryIt')}
              </Button>
            )}
            {pick?.folders && testing && (
              <div className="mt-4 flex items-center gap-2 text-[13px] text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('arm.checking')}
              </div>
            )}
            {/*
              DON'T PREDICT UP FRONT — EXPLAIN ONCE IT'S ALREADY VISIBLE.

              The old copy promised *"first run 20–30 seconds because it has to
              download the tool"* the moment the test starts. That's WRONG for
              the case of reusing a config that already exists: the package is
              already in the `npx` cache, nothing downloads, and the user reads
              a sentence that's clearly not true for what's actually happening.
              → Only say it once the wait has ACTUALLY turned out to be long.
            */}
            {/*
              ⚠ CORRECTED 24/08 — the old copy promised *"Later runs will be
              fast"*, and that's a product promise we CANNOT KEEP.

              Measured 10 times (`scripts/spike-npx-cost.ts`) with the package
              already sitting in the `_npx` cache: end-to-end **7.7–9.2
              seconds**, the first run the same as the third. Most of it is
              `npx`'s own overhead (~3.2s per startup, not package download). A
              real user hit this and reported it correctly: *"it's slow every
              single time, I've never seen a 4-second run"*.

              The new copy only states what's measured, and does NOT promise a
              faster next time — promising fast and staying slow teaches the
              user to stop trusting every other sentence on the screen.
            */}
            {testing && slow && (
              <p className="mt-1.5 text-xs text-muted">
                {t('arm.slowHint')}
              </p>
            )}

            {probe && (
          <ProbeReport
            r={probe}
            // The Sign in button only exists on the catalog path. Pass that
            // fact down instead of letting `ProbeReport` guess — it has no way
            // to guess it.
            hasLoginButton={!!pick?.needsLogin}
            match={pick ? undefined : catalogMatch()}
          />
        )}
            {err && <p className="mt-2 text-xs text-danger">{err}</p>}

            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onClick={() => setStep(1)}>
                {t('arm.goBack')}
              </Button>
              {/* Do NOT allow proceeding without a ✓. → SPEC-tools-approval §10b */}
              <Button variant="primary" className="flex-1" disabled={!ok} onClick={() => setStep(3)}>
                {t('arm.next')}
              </Button>
            </div>
          </div>
        )}

        {/* ────────────────────────── Step 3 · Grant to whom (REQUIRED) */}
        {step === 3 && (
          <div className="max-h-[52vh] overflow-y-auto">
            {agents.length === 0 && (
              <p className="text-[13px] text-muted">
                {t('arm.noAgentsYet')}
              </p>
            )}
            <div className="flex flex-col gap-1">
              {agents.map((n) => (
                <label
                  key={n.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:border-accent"
                >
                  <input
                    type="checkbox"
                    checked={grant.includes(n.role!)}
                    onChange={(e) =>
                      setGrant((g) => (e.target.checked ? [...g, n.role!] : g.filter((r) => r !== n.role)))
                    }
                  />
                  <span>{n.avatar ? `${n.avatar} ` : ''}{n.label}</span>
                </label>
              ))}
            </div>

            {/*
              State the consequence of choosing NOBODY — ALONG WITH its upside.
              Someone who wants to connect it now and grant access later still
              has a path forward without feeling like they did something wrong.
            */}
            <p className="mt-3 text-xs text-muted">
              {grant.length === 0
                ? t('arm.grantNobody')
                : t('arm.grantSome', { n: grant.length })}
              {probe?.tokens ? t('arm.grantTokens', { n: formatNumber(probe.tokens) }) : ''}
            </p>

            {err && <p className="mt-2 text-xs text-danger">{err}</p>}

            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onClick={() => setStep(2)}>
                {t('arm.goBack')}
              </Button>
              <Button variant="primary" className="flex-1" disabled={busy} onClick={() => void save()}>
                {busy ? t('common.saving') : t('arm.done')}
              </Button>
            </div>
          </div>
        )}

        {/*
          The confirmation copy states EXACTLY two facts, because they're two
          different things and the user is at risk of confusing the second one:
            · the config → GONE FOR GOOD, but rebuilding it from the catalog is
              three clicks
            · the key    → **NOT lost**, and that's the expensive part (means
              going back to the vendor's site)
          Not stating the second one would let them think they just lost a
          token, and then nobody dares click it — a button that exists in name
          only.
        */}
        <ConfirmDelete
          open={!!forget}
          title={t('arm.forgetTitle')}
          onCancel={() => setForget(null)}
          onConfirm={() => {
            const a = forget;
            if (!a) return;
            // ⚠ Go through `actions`, do NOT call `api` directly — see the
            // comment block at `store.ts §forgetArm`. Calling it directly would
            // only update the list inside this dialog, leaving `selected`/
            // `canvas` holding a dead id until the user hits F5. (bug the user
            // reported, 26/08)
            void actions
              .forgetArm(a.id)
              .then(() => api.arms())
              .then((r) => setInstalled(forList(r.arms, officeId)))
              .catch((e) => setErr(e instanceof ApiError ? e.message : t('artifacts.deleteFailed')))
              .finally(() => setForget(null));
          }}
        >
          <b>{forget?.label}</b> {t('arm.forgetBody1')} <b>{t('arm.forgetBodyBold')}</b>
          {t('arm.forgetBody2')}
          <br />
          <span className="text-muted">
            {forget?.secrets.length
              ? t('arm.forgetKeysKept', { keys: forget.secrets.join(', ') })
              : t('arm.forgetNoKeys')}
          </span>
        </ConfirmDelete>

        {/*
          Dropping a workspace — state BOTH halves, because the second half is
          what the user actually wants: agentco doesn't just forget the key, it
          also **tells Notion to revoke it**. Deleting only our own copy while
          the key stays alive on their end does exactly half the job, and the
          other half is the half they actually care about.
        */}
        <ConfirmDelete
          open={!!dropWs}
          title={t('arm.dropWsTitle')}
          confirmLabel={t('overview.drop')}
          onCancel={() => setDropWs(null)}
          onConfirm={() => dropNow()}
        >
          {t('arm.dropWsBefore')} <b>{dropWs?.label ?? dropWs?.name}</b> {t('arm.dropWsMid')}{' '}
          <b>{t('arm.dropWsBold')}</b> {t('arm.dropWsAfter')}
          <br />
          <span className="text-muted">{t('arm.dropWsSafe')}</span>
        </ConfirmDelete>
      </DialogContent>
    </Dialog>
  );
}

/**
 * FOLDER PICKER — browse and click, no typing.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY IT FULLY REPLACES THE TEXT FIELD, rather than sitting next to it as  │
 * │ an "extra convenience"                                                   │
 * │                                                                          │
 * │ A text field pushes FOUR problems onto the user, and none of them are    │
 * │ their job: mistyping one character · `\` vs `/` · a folder with spaces   │
 * │ in its name · and the question "which MACHINE is this path on" once the  │
 * │ daemon runs on a VPS.                                                    │
 * │                                                                          │
 * │ Browse-and-click removes all four at once: the string is generated by    │
 * │ the SERVER, in its own correct format, on the exact filesystem the arm   │
 * │ will actually see.                                                       │
 * │                                                                          │
 * │ ⚠ And one thing we MEASURED: `args` goes into `spawn` as an ARRAY, never │
 * │ through a shell. So a folder with spaces just works as-is, while         │
 * │ **wrapping it in quotes BREAKS it** (`failed · MCP error -32000`) — the  │
 * │ quotes become part of the folder name. The picker makes that question    │
 * │ disappear entirely.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function FolderPicker({
  chosen,
  onChange,
  busy,
}: {
  chosen: string[];
  onChange(v: string[]): void;
  /** A test is currently running — locks the change-folder button. See the comment on the button. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="rounded-md border border-line px-3 py-2">
        {chosen.length === 0 ? (
          <div className="py-1 text-xs text-muted">{t('arm.noFolderChosen')}</div>
        ) : (
          // Show the full text, wrap it — see the comment at `BrowseDialog`.
          <div className="break-all font-mono text-[12px]">{chosen[0]}</div>
        )}
        {/*
          TESTING ⇒ LOCK the change-folder button too. This is exactly the door
          the user walked through when they caught the 26/08 bug: pick folder A
          → connecting → quickly switch to Music. `runRef` keeps the result from
          drifting; this button keeps them from ever getting into that situation
          in the first place.
        */}
        <Button size="sm" className="mt-2 w-full" disabled={busy} onClick={() => setOpen(true)}>
          <FolderOpen className="h-3.5 w-3.5" />
          {busy
            ? t('arm.checkingShort')
            : chosen.length
              ? t('arm.changeFolderLong')
              : t('arm.pickFolder')}
        </Button>
      </div>
      <BrowseDialog open={open} onOpenChange={setOpen} onChange={onChange} />
    </>
  );
}

/**
 * FOLDER-BROWSE MODAL — fully separate from the `+ Connect` dialog.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY NOT USE THE OS'S NATIVE FOLDER PICKER — the user asked directly, and │
 * │ the answer is: THE BROWSER CANNOT HAND BACK AN ABSOLUTE PATH.            │
 * │                                                                          │
 * │   `<input webkitdirectory>`  → only returns names RELATIVE to the chosen │
 * │                                folder, with no root                      │
 * │   `showDirectoryPicker()`    → returns a HANDLE, deliberately withholding│
 * │                                the path (that's a security feature, not  │
 * │                                an oversight)                             │
 * │                                                                          │
 * │ Both are deliberate browser fences, not something patchable. And even if │
 * │ it were patchable it would still be wrong: it would list the machine the │
 * │ PERSON IS SITTING AT, while the arm runs on the DAEMON's machine — they  │
 * │ diverge the moment either one is on a VPS or in a container (§10b). A    │
 * │ picker that lists itself is correct in both cases automatically.         │
 * │                                                                          │
 * │ Three things make up for losing the familiar native dialog, and the user │
 * │ asked for all three:                                                     │
 * │  · reopen at the EXACT folder left last time, not back at the drive root │
 * │  · TYPE/PASTE a path directly — faster than any click once you already   │
 * │    know where you're going                                               │
 * │  · a SEPARATE, wide modal, not squeezed inside the in-progress dialog    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function BrowseDialog({
  open,
  onOpenChange,
  onChange,
  start,
  office,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
  onChange(v: string[]): void;
  /**
   * Where to open. Empty ⇒ `office` (if given) ⇒ `LAST_DIR` ⇒ root.
   *
   * ⚠ The Commands tab passes the CURRENTLY SELECTED folder here and
   * deliberately does **not** use `LAST_DIR` (user, 01/09): that cache is the
   * memory of the folder arm, and borrowing it here would open a location
   * with nothing to do with what's being drafted.
   */
  start?: string;
  /**
   * With nothing chosen yet, stand at the **office folder**. Send its **id**,
   * not a path — the server resolves it. → `api.browse`
   */
  office?: string | null;
}) {
  const [cur, setCur] = useState<{ path: string; parent: string | null; dirs: { name: string; path: string }[] }>({
    path: '',
    parent: null,
    dirs: [],
  });
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(false);

  const go = (p?: string, at?: string) => {
    setLoading(true);
    void api
      .browse(p, at)
      .then((r) => {
        setCur(r);
        setTyped(r.path);
        if (r.path) localStorage.setItem(LAST_DIR, r.path);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    /**
     * ⚠ `office` comes BEFORE `LAST_DIR`, not after: wherever `office` is
     * passed in (the Commands tab), that caller has already stated its own
     * default, and falling further down to the folder arm's cache there would
     * open a location with nothing to do with it.
     */
    if (start) go(start);
    else if (office) go(undefined, office);
    else go(localStorage.getItem(LAST_DIR) || undefined);
    // Depend only on `open`: changing `start` while the modal is already open
    // would yank the user back to the root while they're mid-browse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const here = cur.path;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_W}>
        <DialogHeader>
          <DialogTitle>{t('arm.browseTitle')}</DialogTitle>
          <DialogDescription>
            {t('arm.browseDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={cur.parent === null} onClick={() => go(cur.parent ?? undefined)}>
            ↑
          </Button>
          {/* Type/paste directly: once you know where you're going, this beats any amount of clicking. */}
          <Input
            className="flex-1 font-mono text-[12px]"
            value={typed}
            placeholder={t('arm.pathPlaceholder')}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                go(typed.trim() || undefined);
              }
            }}
          />
        </div>

        {/*
          ⚠ SHOW THE FULL PATH, WRAPPED, NEVER TRUNCATED. A path cut off
          mid-way is the cheapest possible misunderstanding to buy:
          `D:\Records\2025\…` and `D:\Records\2026\…` look identical after
          three dots, and the user is about to decide where an agent gets read
          access.
        */}
        <div className="mt-2 rounded-md border border-line bg-panel px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted">{t('arm.currentlyAt')}</div>
          <div className="mt-0.5 break-all font-mono text-[12px]">{here || t('arm.pickADrive')}</div>
        </div>

        {/* THREE columns, not four: at a 46rem-wide box, four columns truncate
            folder names right around the tenth character — and the folder name
            is exactly what someone reads before clicking. */}
        <div className="mt-2 grid max-h-[46vh] grid-cols-3 gap-1 overflow-y-auto rounded-md border border-line p-1">
          {loading && <div className="col-span-3 px-2 py-2 text-xs text-muted">{t('common.reading')}</div>}
          {!loading && cur.dirs.length === 0 && (
            <div className="col-span-3 px-2 py-2 text-xs text-muted">
              {t('arm.noSubfolders')}
            </div>
          )}
          {!loading &&
            cur.dirs.map((d) => (
              <button
                key={d.path}
                type="button"
                onClick={() => go(d.path)}
                title={d.path}
                className="truncate rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent-soft"
              >
                📁 {d.name}
              </button>
            ))}
        </div>

        {/*
          ONE BUTTON, NOT TWO. The earlier version had "Select this folder" and
          then "Done" — two buttons for one intent, forcing the user to guess
          which one actually made the selection. Now **Done = select the
          currently open folder**, exactly as the user suggested.
        */}
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!here}
            onClick={() => {
              onChange([here]);
              onOpenChange(false);
            }}
          >
            {t('arm.useThisFolder')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Handshake result. `status` has FIVE values — `needs-auth` is NOT an error.
 *
 * ⚠ `failed` shows the server's `error` VERBATIM: it's the only string the
 * user can actually copy and go ask someone else about. Replacing it with one
 * of our own generic sentences would take away the one useful thing left. → §6c
 */
function ProbeReport({
  r,
  /** Does this screen HAVE a Sign in button — yes on the catalog path, no on the custom-paste path. */
  hasLoginButton,
  /** The catalog entry sharing a domain with the URL just pasted, if one was recognized. */
  match,
}: {
  r: ProbeResult;
  hasLoginButton: boolean;
  match?: CatalogArm | undefined;
}) {
  if (r.status === 'connected') {
    // `tool`, not `t` — `t` is the translator in this file.
    const read = r.tools.filter((tool) => tool.level === 'read').length;
    /*
      ┌──────────────────────────────────────────────────────────────────────┐
      │ CONNECTED BUT 0 TOOLS — draw as a WARNING, not a ✓ with a footnote.  │
      │                                                                      │
      │ This is the `X-MCP-Toolsets` mistyped-name case: the server          │
      │ handshakes normally, returns empty, with not a single error string   │
      │ (measured 26/08). Drawing a green ✓ here would make the UI **lie on  │
      │ the server's behalf** — and this failure is already silent by itself,│
      │ it doesn't need us adding a second layer of silence on top.          │
      │ → `probe.ts §ProbeResult.warn` · [[agentco-silent-allowlist]]        │
      └──────────────────────────────────────────────────────────────────────┘
    */
    if (r.warn) {
      return (
        <div className="mt-3 rounded-md border border-warn/40 px-3 py-2 text-[13px]">
          <div className="flex items-center gap-1.5 font-medium text-warn">
            <TriangleAlert className="h-4 w-4" />
            {t('arm.probeZeroTools')}
          </div>
          <div className="mt-1 text-xs leading-relaxed text-muted">{r.warn}</div>
        </div>
      );
    }
    return (
      <div className="mt-3 rounded-md border border-line bg-accent-soft/40 px-3 py-2 text-[13px]">
        <div className="flex items-center gap-1.5 font-medium">
          <Check className="h-4 w-4 text-accent" />
          {t('arm.probeOk', { n: plural('inspector.toolCount', r.tools.length) })}
          {r.serverName ? <span className="text-xs font-normal text-muted">· {r.serverName}</span> : null}
        </div>
        <div className="mt-1 text-xs text-muted">
          {t('arm.probeSplit', { read, write: r.tools.length - read })}
          {r.tokens ? ` ${t('arm.tokensPerTurnSuffix', { n: formatNumber(r.tokens) })}` : ''}
        </div>
        {/*
          ┌──────────────────────────────────────────────────────────────────┐
          │ REACH-TEST RESULT — lives INSIDE the ✓ block, doesn't replace it. │
          │                                                                   │
          │ `ok: false` does NOT make the whole test a failure: sign-in still │
          │ works, the arm still connects, what's unfinished is the **app     │
          │ install** — something the user does on the vendor's own screen.   │
          │ Painting the whole block red would merge two different questions  │
          │ into one answer slot, exactly the wrong-door class of failure this│
          │ reach test exists to close.                                       │
          │                                                                   │
          │ But it must also NOT be drawn grey like a footnote: it's the only │
          │ thing telling the user whether the arm they're about to connect   │
          │ can actually do anything, and the ✓ sitting right above it is very│
          │ convincing.                                                       │
          └──────────────────────────────────────────────────────────────────┘
        */}
      </div>
    );
  }
  if (r.status === 'needs-auth') {
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 TWO PATHS, TWO SENTENCES — because the two paths lead to two      │
     * │ different DOORS. (31/08)                                             │
     * │                                                                      │
     * │ What the user hit: pasting                                           │
     * │ `{"type":"http","url":"https://mcp.notion.com/mcp"}` through the     │
     * │ custom-paste path → `needs-auth` → the screen says *"you need to     │
     * │ grant access in the browser"*. The user rejected it, correctly:      │
     * │                                                                      │
     * │   *"there's no way out for them… at minimum, if this service needs   │
     * │    some kind of authorization, they should at least be able to go go │
     * │    find how to authorize it"*                                        │
     * │                                                                      │
     * │ The old copy was written for the CATALOG path, where a Sign in button│
     * │ sits right next to it. The custom-paste path has **no button at all**│
     * │ (`oauthStart` takes a `catalogId`, see SPEC-arms §16q) ⇒ that        │
     * │ sentence **promises a door that doesn't exist**. That's the worst    │
     * │ wrong-door error message: it isn't vague, it's WRONG.                │
     * │                                                                      │
     * │ ⚠ And don't just soften the wording into vagueness. The user needs a │
     * │ **task they can actually do**, so the new copy states the two real   │
     * │ paths: the catalog entry if the vendor was recognized, otherwise how │
     * │ to paste a key directly into the JSON block itself.                  │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    return (
      <div className="mt-3 rounded-md border border-line px-3 py-2 text-[13px]">
        <div className="flex items-center gap-1.5 font-medium">
          <TriangleAlert className="h-4 w-4 text-warn" />
          {hasLoginButton ? t('arm.probeNeedsLoginTitle') : t('arm.probeAuthTitle')}
        </div>
        {hasLoginButton ? (
          <div className="mt-1 text-xs text-muted">
            {t('arm.probeNeedsLoginBefore')} <b>{t('arm.signIn')}</b>{' '}
            {t('arm.probeNeedsLoginAfter')}
          </div>
        ) : (
          <div className="mt-1 space-y-1 text-xs leading-relaxed text-muted">
            <div>
              {t('arm.probeNoKeyBefore')} <b>{t('arm.probeNoKeyBold')}</b>{' '}
              {t('arm.probeNoKeyAfter')}
            </div>
            {match ? (
              <div>
                {t('arm.probeMatchBefore')} <b>{match.name}</b> {t('arm.probeMatchMid')}{' '}
                <b>{t('arm.probeMatchBold')}</b>
                {t('arm.probeMatchAfter')}
              </div>
            ) : (
              /**
               * ⚠⚠ DON'T NAME THE HEADER. (the user caught this, 31/08)
               *
               *   *"is it Bearer everywhere, it seems quite likely that other
               *    servers have a different setup"*
               *
               * Right — and the earlier version printed
               * `"Authorization": "Bearer …"` outright, as if that were a
               * universal rule. In the wild there's `X-API-Key`, there's
               * `Basic`, there are vendor-specific headers, and stdio puts the
               * key into `env` with no header involved at all.
               *
               * ⇒ The right line isn't *"detailed vs. vague"* but
               * **SOMETHING WE OWN vs. SOMETHING THE VENDOR OWNS**:
               *   · the `${…}` placeholder is OUR OWN mechanism → describe it
               *     in full detail, it's always correct
               *   · the field name belongs to the VENDOR → say nothing about
               *     it, point at their README instead
               * Being detailed about what's ours can never turn into being wrong.
               */
              <div>
                {t('arm.probeKeyHintBefore')} <code>headers</code>
                {t('arm.probeKeyHintMid')} <code>env</code>
                {t('arm.probeKeyHintMid2')}{' '}
                <b>
                  {t('arm.probeKeyHintBold')} <code>{'${TEN_CHIA}'}</code>
                </b>
                {t('arm.probeKeyHintAfter')}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-danger/40 px-3 py-2 text-[13px]">
      <div className="font-medium text-danger">{t('arm.probeFailedTitle')}</div>
      {r.error && <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-muted">{r.error}</pre>}
    </div>
  );
}



