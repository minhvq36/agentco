import { memo } from 'react';

import { ArmIcon } from '@/components/ArmIcon';
import { agentInk } from '@/lib/colors';
import { useApp } from '@/lib/store';
import { sizeOf } from './geometry';
import type { CanvasNode } from '@/lib/types';
import { plural, t } from '@i18n';

/**
 * The innards of the Documents node — split out PURELY to hold a performance
 * constraint.
 *
 * It has to follow `libraryBusy`, and `libraryBusy` changes on an SSE event.
 * Subscribing to the store inside `NodeShape` itself would re-render every node
 * on the diagram along with it — exactly what "one SSE event does not re-render
 * the tree" forbids. Split out, only this one node re-renders.
 */
function LibraryBody({ count }: { count: number }) {
  const busy = useApp((s) => s.libraryBusy);
  return (
    <>
      <text className="node-av" x={14} y={40}>
        🗄
      </text>
      <text className="node-nm" x={44} y={30}>
        {t('node.library')}
      </text>
      {/*
        The sub-line says OUTRIGHT how files get in, because this is the only
        node on the diagram where the user acts on IT rather than on a person —
        "click to open" is not enough to infer that files can be dropped here.
      */}
      <text className="node-sub" x={44} y={50}>
        {busy > 0
          ? t('node.libraryBusy', { n: busy })
          : `${plural('node.libraryCount', count)} · ${t('node.libraryHint')}`}
      </text>
    </>
  );
}

function cut(s: string | undefined, n: number): string {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * One node. `memo` because during a drag this component does NOT re-render — the
 * canvas writes the position straight into the wrapping `<g>`'s `transform`.
 *
 * Live state (working / done / failed) does not travel through props either: the
 * canvas puts a class on the `<g>` and CSS handles the rest. That is what keeps
 * one SSE event from re-rendering the tree.
 */
export const NodeShape = memo(function NodeShape({ node }: { node: CanvasNode }) {
  const s = sizeOf(node.kind);
  const ink = node.hue !== undefined ? agentInk(node.hue) : 'var(--color-muted)';

  return (
    <>
      <rect className="node-box" width={s.w} height={s.h} rx={12} />

      {node.kind === 'assistant' && (
        <>
          <text className="node-av" x={16} y={32}>
            {node.avatar || '★'}
          </text>
          <text className="node-nm" x={44} y={26}>
            {cut(node.label, 16)}
          </text>
          <text className="node-sub" x={44} y={44}>
            {cut(node.tier, 22)}
          </text>
          <text className="node-sub" x={16} y={s.h - 10}>
            📒 {node.count ?? 0}
          </text>
        </>
      )}

      {node.kind === 'knowledge' && (
        <>
          <text className="node-av" x={14} y={40}>
            📚
          </text>
          <text className="node-nm" x={44} y={30}>
            {t('node.knowledge')}
          </text>
          <text className="node-sub" x={44} y={50}>
            {plural('knowledge.noteCount', node.count ?? 0)} · {t('node.knowledgeHint')}
          </text>
        </>
      )}

      {/*
        Documents. The sub-line says OUTRIGHT how files get in, because this is
        the only node on the diagram where the user acts on IT rather than on a
        person — "click to open" is not enough to infer that files can be dropped.
      */}
      {node.kind === 'library' && <LibraryBody count={node.count ?? 0} />}

      {node.kind === 'mcp' && (
        <>
          {/*
            ┌────────────────────────────────────────────────────────────────┐
            │ THE VENDOR'S MARK, NOT A PLUG EMOJI. (settled 28/08)            │
            │                                                                 │
            │ > *"change the plug symbol to the same simple one you just      │
            │ >  switched to (reuse — I find it very minimal and good)"*      │
            │                                                                 │
            │ The same function as the Connection dialog (`ArmIcon`), so one  │
            │ arm keeps its mark from the moment it is picked to the moment   │
            │ it sits on the diagram. The 🔌 emoji both carried the OS        │
            │ font's colours and said PROTOCOL TYPE, when what people need    │
            │ to tell apart is WHICH VENDOR.                                  │
            │                                                                 │
            │ ⚠ Positioned with `x`/`y`/`size`, not classes: this is inside   │
            │ the diagram's `<svg>`, and Tailwind cannot reach that system.   │
            └────────────────────────────────────────────────────────────────┘
          */}
          <g className="node-av-mark">
            <ArmIcon
              mark={node.mark}
              kind={node.armKind ?? 'custom'}
              x={12}
              y={s.h / 2 - 9}
              size={18}
            />
          </g>
          <text className="node-nm" x={38} y={s.h / 2 - 3}>
            {cut(node.label, 14)}
          </text>
          {/*
            ┌────────────────────────────────────────────────────────────────┐
            │ THE SUB-LINE NAMES THE ACCOUNT, not "connection". (27/08)      │
            │                                                                │
            │ > *"once it is on the canvas you cannot tell them apart"*      │
            │                                                                │
            │ The word "connection" repeats what the plug already said — it  │
            │ spends a line to add nothing. What people genuinely need to    │
            │ tell apart (two GitHub arms on two accounts) lived only in     │
            │ `label`, and a label FREEZES at the first account.             │
            │                                                                │
            │ `via` is resolved by the server from `arms[].secrets` on every │
            │ read of the diagram, so it cannot go stale. No `via` ⇒ the     │
            │ entry does not use OAuth (or the workspace was removed) ⇒ fall │
            │ back to the old line, NEVER invent a name.                     │
            │ → `ArmDialog.tsx` (where the account stopped being glued on)   │
            └────────────────────────────────────────────────────────────────┘
          */}
          {/*
            ⚠ A RED BORDER ALONE IS A RIDDLE. The colour says *"something is
            wrong here"*; only the sub-line says **what**, and that this one is
            fixable by signing in rather than by editing anything.

            It takes priority over `via` because the two answer different
            questions and only one of them is urgent: `via` answers *"which
            account is this"*, this answers *"can it run at all"*. `missing`
            still wins over both — an arm whose config has vanished cannot be
            repaired by signing in, so offering that would be the wrong door.
          */}
          {/*
            ⚠ `keyGone` sits BELOW `keyDead` in the order and above `via`, for
            the same reason `keyDead` beat `via`: both answer *"can it run at
            all"*. When somehow both are true, "the service refused you" is the
            more specific fact and the one whose fix also fills the store.
          */}
          <text
            className={`node-sub${(node.keyDead || node.keyGone) && !node.missing ? ' node-sub-alert' : ''}`}
            x={38}
            y={s.h / 2 + 13}
          >
            {node.missing
              ? t('node.armMissing')
              : node.keyDead
                ? t('node.armKeyDead')
                : node.keyGone
                  ? t('node.armKeyGone')
                  : node.via
                    ? cut(node.via, 16)
                    : t('node.armFallback')}
          </text>
        </>
      )}

      {/*
        ⚠ ANCHORED TO THE BOTTOM, NOT A FIXED NUMBER.

        The previous version wrote `y={76}` for the last line, back when a node
        was 88 tall — 12px of clearance. The day nodes shrank to 76 (23/08) that
        line landed exactly on the bottom edge, touching the border. A legitimate
        constant changed in another file and this broke silently — the same
        family as the two tests hard-coding a grid step that broke that same day.

        Anchoring to `s.h` makes every later size change correct by itself.
      */}
      {node.kind === 'agent' && (
        <>
          <rect x={0} y={0} width={4} height={s.h} rx={2} fill={ink} className="node-stripe" />
          <text className="node-av" x={16} y={30}>
            {node.avatar || '•'}
          </text>
          <text className="node-nm" x={44} y={28}>
            {cut(node.label, 15)}
          </text>
          {/* The live `say` line — the canvas writes textContent straight in here. */}
          <text className="node-say" x={16} y={s.h - 30} />
          <text className="node-sub" x={16} y={s.h - 12}>
            {node.missing ? t('node.roleMissing') : `📒 ${node.count ?? 0}  ·  ${node.tier ?? ''}`}
          </text>
          {!node.connected && (
            <text className="node-sub" x={s.w - 12} y={s.h - 12} textAnchor="end">
              {t('node.resting')}
            </text>
          )}
        </>
      )}
    </>
  );
});
