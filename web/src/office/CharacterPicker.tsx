import { CAST } from '@core/cast';

import { actions, useApp } from '@/lib/store';
import type { CanvasNode } from '@/lib/types';
import { t } from '@i18n';

import { Character, CharacterDefs } from './renderers/dom/Character';
import './renderers/dom/office.css';

/**
 * Pick a character for one person. → docs/SPEC-office-animation.md §4a
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT LIVES IN THE OFFICE CHUNK, and that is not filing tidiness.           │
 * │                                                                          │
 * │ It draws with `Character`, so importing it straight into the inspector    │
 * │ would drag the whole cast into the MAIN bundle and quietly undo the code  │
 * │ split — everybody would download the room, including the people who       │
 * │ switched it off. The inspector reaches it through a lazy import, gated on │
 * │ `officeView`, so "off" still fetches nothing. §11c②                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Every swatch is the REAL drawing at a small scale, not an icon standing in
 * for it: a preview that is not the thing makes people pick twice.
 */
export default function CharacterPicker({ node }: { node: CanvasNode }) {
  const current = node.character ?? 0;
  const busy = useApp((s) => s.officeState === 'working');

  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
        {t('office.character')}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {CAST.map((m) => {
          const on = m.id === current;
          return (
            <button
              key={m.id}
              type="button"
              aria-label={t('office.characterPick', { n: String(m.id + 1) })}
              aria-pressed={on}
              disabled={busy}
              onClick={() => void actions.setCharacter(node.id, m.id)}
              className={`rounded-lg border p-0.5 transition-colors disabled:opacity-50 ${
                on ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'
              }`}
            >
              {/* The world is y-up from the feet, so the swatch's viewBox starts
                  above the head and ends just below them. One transform, no
                  second set of measurements to keep in step. */}
              <svg width={30} height={48} viewBox="-25 -142 50 152" aria-hidden="true">
                <CharacterDefs />
                <Character cast={m.id} pose="front" />
              </svg>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{t('office.characterHint')}</p>
    </div>
  );
}
