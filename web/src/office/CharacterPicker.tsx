import { actions, useApp } from '@/lib/store';
import type { CanvasNode } from '@/lib/types';
import { t } from '@i18n';

import { FRAMES, SPRITES } from './art/manifest';
import { SpriteFrame } from './art/SpriteFrame';
import './renderers/dom/office.css';

/**
 * Pick a character for one person. → docs/SPEC-office-animation.md §4a
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT LIVES IN THE OFFICE CHUNK, and that is not filing tidiness.           │
 * │                                                                          │
 * │ It draws with the cast sprites, so importing it straight into the         │
 * │ inspector would drag the whole cast into the MAIN bundle and quietly      │
 * │ undo the code split — everybody would download the room, including the    │
 * │ people who switched it off. The inspector reaches it through a lazy        │
 * │ import, gated on `officeView`, so "off" still fetches nothing. §11c②      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ ONE SWATCH PER SPRITE, NOT PER `CAST` ROW.
 *
 * `CAST` is ten rows and there are five strips, so cast ids wrap: id 7 and id 2
 * are the same face. Offering ten swatches would show every person twice and
 * make somebody pick "a different one" that is not different — the exact failure
 * this component's own header used to warn about when the swatch was not the
 * real drawing. Offer what actually exists.
 *
 * Every swatch is the REAL sprite at a small scale, not an icon standing in for
 * it: a preview that is not the thing makes people pick twice.
 */
export default function CharacterPicker({ node }: { node: CanvasNode }) {
  const current = node.character ?? 0;
  const busy = useApp((s) => s.officeState === 'working');

  return (
    <div className="mt-3 office-light">
      <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
        {t('office.character')}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {SPRITES.map((_, cast) => {
          const on = cast === current % SPRITES.length;
          return (
            <button
              key={cast}
              type="button"
              aria-label={t('office.characterPick', { n: String(cast + 1) })}
              aria-pressed={on}
              disabled={busy}
              onClick={() => void actions.setCharacter(node.id, cast)}
              className={`overflow-hidden rounded-lg border p-0.5 transition-colors disabled:opacity-50 ${
                on ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'
              }`}
            >
              {/* The standing frame: a swatch showing somebody mid-stride would
                  be a different picture from the one they will mostly see. */}
              <SpriteFrame cast={cast} frame={FRAMES.stand} height={52} />
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{t('office.characterHint')}</p>
    </div>
  );
}
