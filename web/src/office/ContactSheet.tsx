import { FRAMES, SPRITES } from './art/manifest';
import { SpriteFrame } from './art/SpriteFrame';
import './renderers/dom/office.css';

/**
 * THE CONTACT SHEET — every character, every frame, on one screen.
 * → docs/SPEC-office-art.md
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE "STANDARD TO CHECK AGAINST".                                 │
 * │                                                                          │
 * │ Six generated cells per person land here before they land in the room.   │
 * │ Feet on one line, heads on one line, the same person in every cell — a   │
 * │ strip that fails any of those makes a room where somebody grows and      │
 * │ shrinks as they walk.                                                    │
 * │                                                                          │
 * │ ⚠ AND THE WALK CONTACTS MUST DIFFER. `walk1` and `walk3` are drawn side  │
 * │ by side here on purpose: the generator returned the same leading leg in   │
 * │ both, five characters out of five, and a numeric diff was not enough to   │
 * │ catch it — two frames next to each other were.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ SIZED AT BOTH SIZES THAT MATTER. A defect at the shipping size (~133 px)
 * and a defect at the `2.5×` zoom ceiling are different defects; a review at
 * some arbitrary size in between finds neither reliably.
 *
 * ⚠ DEV ONLY. Reached at `#cast` in the dev server and guarded by
 * `import.meta.env.DEV` in `main.tsx`, so the production bundle never contains
 * it — leg G-11 of test 23 checks exactly that.
 */
const LABELS = ['stand', 'walk1', 'walk2', 'walk3', 'walk4', 'sit'] as const;

export default function ContactSheet() {
  // `office-light` pins the cast palette to the lit values, the same way the
  // room does — reviewing the drawing under the app's dark chrome is exactly how
  // the white-pupil and grey-hair bugs stayed invisible. → office.css
  return (
    <div
      className="office-light"
      style={{ minHeight: '100%', background: 'var(--color-paper)', color: 'var(--color-ink)' }}
    >
      <div style={{ padding: '20px 24px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Cast contact sheet</h1>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 4, maxWidth: '70ch' }}>
          {SPRITES.length} characters × {LABELS.length} frames. Feet and heads must line up across
          every column. <strong>walk1 and walk3 must show opposite legs forward</strong> — if the
          same foot leads in both, the walk animation trembles in place instead of walking.
        </p>

        {[133, 333].map((h) => (
          <section key={h} style={{ marginTop: 26 }}>
            <h2
              style={{
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: '0.09em',
                color: 'var(--color-muted)',
              }}
            >
              {h === 133 ? 'shipping size — 133px' : 'zoom ceiling — 2.5×'}
            </h2>
            {SPRITES.map((_, cast) => (
              <div key={cast} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
                <div
                  style={{
                    width: 56,
                    fontSize: 12,
                    color: 'var(--color-muted)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  cast {cast}
                </div>
                {LABELS.map((label, frame) => (
                  <figure key={label} style={{ margin: 0, textAlign: 'center' }}>
                    <div
                      style={{
                        border: '1px solid var(--color-line)',
                        borderRadius: 8,
                        background: 'var(--color-panel)',
                        padding: 4,
                        // The baseline: every cell's floor is the same line, so a
                        // strip whose feet drifted shows as a cell that hangs.
                        borderBottom: '2px solid var(--color-accent)',
                      }}
                    >
                      <SpriteFrame cast={cast} frame={frame} height={(h / 258) * 300} />
                    </div>
                    <figcaption style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 3 }}>
                      {label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ))}
          </section>
        ))}

        <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 24 }}>
          Frame order is positional and shared with <code>FRAMES</code> in{' '}
          <code>art/manifest.ts</code>: stand · {FRAMES.walk.length} walk cells · sit.
        </p>
      </div>
    </div>
  );
}
