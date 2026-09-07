import { GARMENT_TINTS } from '@core/cast';

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
      {/* ⚠ NO EXPLANATORY PARAGRAPH. Five faces in a row are self-describing, and
          "costs nothing and changes nothing about the work" was answering a worry
          the control never raised. → SPEC-office-animation.md §17i */}

      <TintPicker node={node} />
    </div>
  );
}

/**
 * 🔴 THE GARMENT COLOUR. → docs/SPEC-office-art.md §11
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A NATIVE `<input type="color">`, NOT A HAND-BUILT WHEEL.                 │
 * │                                                                          │
 * │ The ask was a continuous picker — "the rainbow square". That is exactly   │
 * │ what the platform's own control opens, it is the one the user's OS       │
 * │ already taught them, it costs ZERO bundle bytes, and it fires `input` on │
 * │ every pointer move so the room follows the finger. A wheel drawn here    │
 * │ would be a few hundred lines and worse at all four.                       │
 * │                                                                          │
 * │ ⚠ THE TEN SWATCHES ARE NOT DECORATION. The palette is authored at        │
 * │ MID-LIGHTNESS on purpose (`core/cast.ts §GARMENT_TINTS`), because        │
 * │ `mix-blend-mode: color` keeps the artwork's luminance: a near-black or   │
 * │ near-white pick changes almost nothing on screen. The swatches are the   │
 * │ set that is known to work; the wheel is the door out of it.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ It is offered for EVERYBODY, not only for people who currently share a face.
 * The auto-tint answers *"two people look alike right now"*; a person choosing a
 * colour is answering *"I want this person in green"*, and gating the second on
 * the first would make the control appear and disappear as colleagues are hired.
 */
function TintPicker({ node }: { node: CanvasNode }) {
  const busy = useApp((s) => s.officeState === 'working');
  // ⚠ Falls back to the FIRST palette entry, not to white or to black: the native
  // control has to open somewhere, and it should open inside the range that works.
  const current = node.tint ?? GARMENT_TINTS[0]!;

  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
        {t('office.tint')}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {GARMENT_TINTS.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={hex}
            aria-pressed={node.tint === hex}
            disabled={busy}
            onClick={() => actions.setTint(node.id, hex)}
            style={{ background: hex }}
            className={`h-6 w-6 rounded-md border transition-transform disabled:opacity-50 ${
              node.tint === hex ? 'border-ink scale-110' : 'border-line hover:scale-110'
            }`}
          />
        ))}
        {/* The continuous picker. `onInput`, not `onChange`: `change` only fires
            when the OS dialog closes, and the point is that the room follows the
            pointer while it is open. The write to disk is debounced in the store. */}
        <label
          className="ml-0.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-line hover:border-accent"
          style={{
            background:
              'conic-gradient(#e5484d,#e8a020,#a8c73a,#30b06e,#3ba4c9,#5b62d8,#a05ac0,#e5484d)',
          }}
          title={t('office.tintCustom')}
        >
          <span className="sr-only">{t('office.tintCustom')}</span>
          <input
            type="color"
            value={current}
            disabled={busy}
            onInput={(e) => actions.setTint(node.id, e.currentTarget.value)}
            className="h-0 w-0 opacity-0"
          />
        </label>
      </div>
    </div>
  );
}
