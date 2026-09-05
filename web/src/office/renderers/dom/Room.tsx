import { memo } from 'react';

import { plural, t } from '@i18n';
import { BREAK_AREA, HORIZON, STATIONS, WORLD } from '@core/office-floor';

/**
 * THE FURNITURE. → docs/SPEC-office-animation.md §5a′
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ROOM IS NEVER EMPTY, AND THAT IS A GUARANTEE, NOT LUCK.              │
 * │                                                                          │
 * │ A brand-new office with zero employees still renders a COMPLETE room:    │
 * │ every station, plus the assistant standing at centre-front. The          │
 * │ assistant is guaranteed by the architecture (one per office, not         │
 * │ deletable); the bookshelf, the filing desk and the break area exist for  │
 * │ every office by definition — they are the library, the artifacts         │
 * │ directory and the resting state, all three of which exist from the       │
 * │ moment the folder does.                                                  │
 * │                                                                          │
 * │ ⛔ There is deliberately NO empty-state screen replacing the room. That   │
 * │ is the 02/09 bug through a new door: the app used to swap the whole      │
 * │ working area for a centred paragraph and took three management doors     │
 * │ away with it. An assistant standing alone IS the empty state, and it     │
 * │ says "this is your office, nobody works here yet" better than a          │
 * │ paragraph does.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `memo` with no live props: the furniture does not move, so it must not
 * re-render when an SSE event changes somebody's status line.
 */
export const Room = memo(function Room({
  armCount,
  libraryCount,
  onOpen,
}: {
  armCount: number;
  libraryCount: number;
  onOpen(what: 'library' | 'artifacts' | 'arm'): void;
}) {
  const shelf = STATIONS.library;
  const bench = STATIONS.arm;
  const desk = STATIONS.artifacts;

  return (
    <g className="room">
      <rect className="wall" x={0} y={0} width={WORLD.w} height={HORIZON} />
      <rect className="floor" x={0} y={HORIZON} width={WORLD.w} height={WORLD.h - HORIZON} />
      <path className="skirting" d={`M 0 ${HORIZON} L ${WORLD.w} ${HORIZON}`} />
      {/* A window on the back wall. It is the cheapest thing in the scene that
          makes it read as a place rather than as a diagram with furniture. */}
      <g className="window">
        <rect className="pane" x={560} y={84} width={300} height={168} rx={6} />
        <path className="furn-line" d="M 710 84 L 710 252 M 560 168 L 860 168" />
        <rect className="sill" x={548} y={252} width={324} height={10} rx={4} />
      </g>

      {/* ── the document library */}
      <Station
        label={`${t('node.library')} · ${plural('node.libraryCount', libraryCount)}`}
        hint={t('office.openLibrary')}
        onOpen={() => onOpen('library')}
        x={shelf.x}
        y={shelf.y}
        w={shelf.w}
        h={shelf.h}
      >
        <rect className="furn" x={shelf.x} y={shelf.y} width={shelf.w} height={shelf.h} rx={5} />
        {[0, 1, 2, 3].map((row) => {
          const top = shelf.y + 12 + row * 50;
          return (
            <g key={row}>
              <path
                className="furn-line"
                d={`M ${shelf.x + 7} ${top + 44} L ${shelf.x + shelf.w - 7} ${top + 44}`}
              />
              {Array.from({ length: 8 }, (_, i) => {
                const h = 40 - ((i * 7 + row * 5) % 11);
                return (
                  <rect
                    key={i}
                    className={`book book-${((i + row * 3) % 5) + 1}`}
                    x={shelf.x + 16 + i * 29}
                    y={top + 44 - h}
                    width={19}
                    height={h}
                    rx={2}
                  />
                );
              })}
            </g>
          );
        })}
      </Station>

      {/* ── the arm bench. Nothing plugged in ⇒ dimmed and DASHED, the diagram's
             own vocabulary for "nothing is wired here". It does not disappear:
             a floor plan that changes shape per office is a floor plan nobody
             can learn. */}
      <Station
        label={armCount ? plural('office.armCount', armCount) : t('office.armNone')}
        hint={armCount ? t('office.openArm') : t('office.connectArm')}
        onOpen={() => onOpen('arm')}
        x={bench.x}
        y={bench.y}
        w={bench.w}
        h={bench.h}
        muted={armCount === 0}
      >
        {/* the desk top, then legs — a slab floating in mid-air was most of
            what made the first cut look like clip-art */}
        <rect className="furn" x={bench.x} y={bench.y + 74} width={bench.w} height={14} rx={4} />
        <rect className="furn" x={bench.x + 14} y={bench.y + 88} width={12} height={bench.h - 88} rx={3} />
        <rect className="furn" x={bench.x + bench.w - 26} y={bench.y + 88} width={12} height={bench.h - 88} rx={3} />
        {/* the laptop: a screen raked back, a keyboard plate in front */}
        <path
          className="furn"
          d={`M ${bench.x + 108} ${bench.y + 74} L ${bench.x + 124} ${bench.y + 14} L ${bench.x + 214} ${bench.y + 14} L ${bench.x + 230} ${bench.y + 74} Z`}
        />
        <rect className="screen" x={bench.x + 128} y={bench.y + 20} width={82} height={48} rx={3} />
        <path
          className="furn"
          d={`M ${bench.x + 98} ${bench.y + 74} L ${bench.x + 240} ${bench.y + 74} L ${bench.x + 232} ${bench.y + 82} L ${bench.x + 106} ${bench.y + 82} Z`}
        />
        {/* a mug, because a desk with nothing on it reads as furniture in a shop */}
        <rect className="cup" x={bench.x + 258} y={bench.y + 56} width={17} height={19} rx={3} />
      </Station>

      {/* ── the filing desk: where results land. Deliberately within a short
             walk of the assistant — that walk is the hand-off beat. */}
      <Station
        label={t('office.desk')}
        hint={t('office.openResults')}
        onOpen={() => onOpen('artifacts')}
        x={desk.x}
        y={desk.y}
        w={desk.w}
        h={desk.h}
      >
        <rect className="furn" x={desk.x} y={desk.y + 40} width={desk.w} height={13} rx={4} />
        <rect className="furn" x={desk.x + 16} y={desk.y + 53} width={12} height={desk.h - 53} rx={3} />
        <rect className="furn" x={desk.x + desk.w - 28} y={desk.y + 53} width={12} height={desk.h - 53} rx={3} />
        {/* a stack of finished work, and one sheet set aside */}
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            className="paper"
            x={desk.x + 34 + i * 5}
            y={desk.y + 40 - 7 - i * 7}
            width={74}
            height={9}
            rx={2}
          />
        ))}
        <rect className="paper" x={desk.x + 160} y={desk.y + 26} width={74} height={14} rx={2} />
      </Station>

      {/* ── the break area. The only place with chairs, and the only place
             anybody sits. → §5a */}
      <g className="break-area" aria-hidden="true">
        <rect className="rug" x={BREAK_AREA.x} y={BREAK_AREA.y} width={BREAK_AREA.w} height={BREAK_AREA.h} rx={16} />
        <text className="break-label" x={BREAK_AREA.x + 16} y={BREAK_AREA.y + 24}>
          {t('office.breakArea')}
        </text>

        {/* coffee: a round table, two mugs on it */}
        <ellipse className="furn" cx={BREAK_AREA.x + 92} cy={BREAK_AREA.y + 108} rx={44} ry={20} />
        <rect className="furn" x={BREAK_AREA.x + 87} y={BREAK_AREA.y + 118} width={10} height={38} rx={3} />
        <ellipse className="furn" cx={BREAK_AREA.x + 92} cy={BREAK_AREA.y + 158} rx={26} ry={9} />
        <rect className="cup" x={BREAK_AREA.x + 74} y={BREAK_AREA.y + 92} width={15} height={17} rx={3} />
        <rect className="cup" x={BREAK_AREA.x + 100} y={BREAK_AREA.y + 98} width={15} height={17} rx={3} />

        {/* foosball */}
        <rect className="furn" x={BREAK_AREA.x + 176} y={BREAK_AREA.y + 74} width={148} height={72} rx={6} />
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            className="furn-line"
            d={`M ${BREAK_AREA.x + 210 + i * 40} ${BREAK_AREA.y + 66} L ${BREAK_AREA.x + 210 + i * 40} ${BREAK_AREA.y + 154}`}
          />
        ))}
        <rect className="furn" x={BREAK_AREA.x + 186} y={BREAK_AREA.y + 146} width={10} height={30} rx={3} />
        <rect className="furn" x={BREAK_AREA.x + 304} y={BREAK_AREA.y + 146} width={10} height={30} rx={3} />

        {/* chess */}
        <rect className="furn" x={BREAK_AREA.x + 46} y={BREAK_AREA.y + 196} width={96} height={72} rx={5} />
        {Array.from({ length: 24 }, (_, i) => (
          <rect
            key={i}
            className={(Math.floor(i / 6) + i) % 2 === 0 ? 'sq-a' : 'sq-b'}
            x={BREAK_AREA.x + 54 + (i % 6) * 13}
            y={BREAK_AREA.y + 206 + Math.floor(i / 6) * 13}
            width={13}
            height={13}
          />
        ))}

        {/* a screen on a stand, and the console under it */}
        <rect className="screen" x={BREAK_AREA.x + 366} y={BREAK_AREA.y + 62} width={140} height={82} rx={5} />
        <rect className="furn" x={BREAK_AREA.x + 428} y={BREAK_AREA.y + 144} width={16} height={22} rx={3} />
        <rect className="furn" x={BREAK_AREA.x + 396} y={BREAK_AREA.y + 166} width={80} height={9} rx={4} />
        <rect className="furn" x={BREAK_AREA.x + 380} y={BREAK_AREA.y + 208} width={112} height={26} rx={5} />
        <rect className="cup" x={BREAK_AREA.x + 418} y={BREAK_AREA.y + 215} width={36} height={12} rx={6} />
      </g>
    </g>
  );
});

/**
 * One piece of furniture that OPENS SOMETHING.
 *
 * A button, not a decoration: it takes focus, answers `Enter`, and carries its
 * own accessible name. A station that opens a panel and cannot be tabbed to is a
 * door only a mouse can use.
 */
function Station({
  label,
  hint,
  onOpen,
  x,
  y,
  w,
  h,
  muted,
  children,
}: {
  label: string;
  hint: string;
  onOpen(): void;
  x: number;
  y: number;
  w: number;
  h: number;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <g
      className={`station${muted ? ' is-muted' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${label} — ${hint}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <title>{`${label} — ${hint}`}</title>
      {children}
      <text className="station-label" x={x + w / 2} y={y + h + 24} textAnchor="middle">
        {label}
      </text>
      {/* One generous hit area rather than per-shape hit testing: a click that
          lands between two books must still open the library. */}
      <rect className="station-hit" x={x - 12} y={y - 12} width={w + 24} height={h + 48} rx={8} />
    </g>
  );
}
