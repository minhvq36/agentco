import { CAST } from '@core/cast';

import { Character, CharacterDefs, type Pose } from './renderers/dom/Character';
import './renderers/dom/office.css';

/**
 * THE CONTACT SHEET — every character, every pose, both themes, on one screen.
 * → docs/SPEC-office-animation.md §2b④
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE "STANDARD TO CHECK AGAINST".                                 │
 * │                                                                          │
 * │ A proportion that slipped is invisible while you look at one character    │
 * │ and obvious the moment the tenth stands beside the first. Heads on one    │
 * │ line, shoulders on one line, feet on one line — anything that is not is   │
 * │ a part drawn by eye instead of to the `u` grid.                          │
 * │                                                                          │
 * │ It costs an afternoon once, because it is the same component in a loop.   │
 * │ Reviewing art by argument instead costs an afternoon every time.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ DEV ONLY. Reached at `#cast` in the dev server and guarded by
 * `import.meta.env.DEV` in `main.tsx`, so the production bundle never contains
 * it — leg G-11 of test 23 checks exactly that.
 */
const POSES: Pose[] = ['front', 'side', 'sit'];

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
        <p style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 4 }}>
          {CAST.length} characters × {POSES.length} poses. Heads, shoulders and feet must line up
          across every column; a row that does not is a part drawn by eye rather than to the grid.
        </p>

        {POSES.map((pose) => (
          <section key={pose} style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--color-muted)' }}>
              {pose}
            </h2>
            {/* One shared baseline across the row: every character is drawn into
                the SAME viewBox, so a mismatch shows as a mismatch instead of
                being hidden by per-cell scaling. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {CAST.map((m) => (
                <div
                  key={m.id}
                  style={{
                    border: '1px solid var(--color-line)',
                    borderRadius: 10,
                    background: 'var(--color-panel)',
                    padding: 6,
                    textAlign: 'center',
                  }}
                >
                  <svg width={84} height={148} viewBox="-40 -148 80 158" aria-label={`cast ${m.id}`}>
                    <CharacterDefs />
                    {/* The shared baseline, plus the eye line: two rules across
                        every cell, and a proportion that slipped shows up as a
                        cell that does not touch them. */}
                    <path
                      d="M -40 0 L 40 0 M -40 -121 L 40 -121"
                      stroke="var(--color-line)"
                      strokeDasharray="3 3"
                      strokeWidth={1}
                    />
                    <Character cast={m.id} pose={pose} />
                  </svg>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                    {m.id} · {m.hair}
                    {m.headwear !== 'none' ? ` · ${m.headwear}` : ''}
                    {m.accessory !== 'none' ? ` · ${m.accessory}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
