import { memo } from 'react';

import { plural, t } from '@i18n';
import { MAX_SIT_LIFT } from '@core/cast';
import {
  BREAK_AREA,
  BREAK_PIECES,
  CHESS_SEAT,
  COOLER,
  HORIZON,
  PLANT,
  STATIONS,
  WORLD,
} from '@core/office-floor';

import { FURNITURE, WALL, widthOf, type Piece } from '../../art/furniture';

/**
 * THE FURNITURE. → docs/SPEC-office-animation.md §5a′ · SPEC-office-art.md §3
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
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ EVERY OBJECT IS A BITMAP NOW, AND THE COORDINATES STAYED PUT.         │
 * │                                                                          │
 * │ The furniture used to be hand-drawn SVG paths written inline here. It is │
 * │ generated art placed by `<Furn>`/`<Wall>` — but `STATIONS` and           │
 * │ `BREAK_AREA` in `core/office-floor.ts` are UNCHANGED, because those      │
 * │ rectangles are what `ringSlots()` derives standing positions from. A     │
 * │ picture that disagrees with them puts people inside furniture.           │
 * │                                                                          │
 * │ So the rule is one-way: the ART follows the COORDINATES. When a piece    │
 * │ does not fit its station, the piece moves — never the station.           │
 * │                                                                          │
 * │ ⚠ 08/09 restated it from the other end, and NOTHING HERE MOVED: two      │
 * │ stations now name the place they are USED from (`Station.use`), so a     │
 * │ worker stands at the cabinet and behind the arm bench's desk instead of  │
 * │ beside them. That is a change to where a PERSON walks, in `core` — the   │
 * │ furniture did not shift by one unit, and the constraint that the desk    │
 * │ must actually cover the legs is held in `test/office-view.test.ts`.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `memo` with no live props: the furniture does not move, so it must not
 * re-render when an SSE event changes somebody's status line.
 */

/**
 * ── THE CONTACT SHADOW UNDER FLOOR FURNITURE. → SPEC-office-art.md §7a
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 NOT `.actor-shadow`, AND REUSING IT WOULD BE THE MISTAKE.             │
 * │                                                                          │
 * │ The ellipse under a person is a STATUS LIGHT and a FOCUS RING that       │
 * │ happens to look like a shadow — it flashes green on a finished task and  │
 * │ red on a failure. Furniture has no status and takes no focus, so its     │
 * │ shadow is pure decoration: a static `<ellipse>` inside the `memo`'d room │
 * │ layer, painted once and never re-rendered.                              │
 * │                                                                          │
 * │ Two things it DOES inherit, and both are load-bearing:                   │
 * │                                                                          │
 * │  · the WIDTH comes from `widthOf(p)`, never a constant. A sofa's         │
 * │    footprint is three times a plant's; one ellipse size for both puts    │
 * │    the plant on a raft — and deriving it means the shadow cannot drift   │
 * │    when a piece is regenerated at a new aspect ratio.                    │
 * │  · the COLOUR and the softness are the person's exact recipe. Two shadow │
 * │    recipes in one room is two light sources, and that reads instantly    │
 * │    even when nobody can say why.                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Wall objects get none. They never touch the floor, and an ellipse under a
 * window is a window standing on the ground.
 */
const SHADOW = 'office-floor-shadow';

/**
 * 🔴 HOW FAR THE ROOM PAINTS PAST ITS OWN WORLD RECTANGLE. → SPEC-office-art §4
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE WHITE BARS WERE THE LETTERBOX, AND THE FIX IS PAINT, NOT GEOMETRY.    │
 * │                                                                           │
 * │ `preserveAspectRatio="xMidYMid meet"` fits a 1600×900 world into a frame  │
 * │ of some other shape, so one axis is left over — white bars top-and-bottom │
 * │ or left-and-right depending on the window. Every obvious cure is worse:   │
 * │                                                                           │
 * │  ⛔ `slice` / `Math.max` in `fit()` — fills the frame by CROPPING the     │
 * │     room. The break area or the front row goes off screen, silently, and  │
 * │     only on some window shapes.                                           │
 * │  ⛔ growing the `<svg>` box past `.office-pan` — `fit()` places the HTML  │
 * │     people from the ROOT rect while the svg fits itself to its OWN box.   │
 * │     Change one and the two layers drift apart by exactly that much,       │
 * │     which is the register the whole two-layer design rests on.            │
 * │                                                                           │
 * │ ⇒ Keep the geometry untouched and paint FURTHER. The wall, the floor, the │
 * │ baseboard and the planks all run to ±BLEED; the outer `<svg>` clips them  │
 * │ to its viewport. Nothing moves, nothing is cropped, and the bars fill     │
 * │ with the surface that was already next to them.                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ 2400 is not decoration: at a 32:9 window `k` is set by the height and the
 * visible world reaches ~1120 units past each side. This covers past 40:9 and
 * costs four rectangles that never re-render.
 */
const BLEED = 2400;

/** Spacing between board seams AT THE HORIZON. They widen toward the viewer. */
const PLANK_W = 38;

/**
 * 🔴 THE BOARDS CONVERGE, AND THIS REVERSES A RULE §3 WROTE DOWN. → SPEC §4
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT §3 BANNED AND WHY, BEFORE ANYONE UNDOES THIS BY QUOTING IT.          │
 * │                                                                           │
 * │ `SPEC-office-art §3`: *"converging lines claim a vanishing point, which   │
 * │ then obliges every character to scale with depth."* That is a real cost   │
 * │ and it has not been paid: `CH_H` is one number and a person is the same   │
 * │ size at the back wall as at the front.                                    │
 * │                                                                           │
 * │ The user's call, with the trade named: a board floor whose boards run     │
 * │ parallel reads as a printed pattern rather than as a floor, and the fan   │
 * │ is kept SHALLOW precisely so it does not make a promise the figures       │
 * │ cannot keep — 30% spread across the whole floor, not a corridor.          │
 * │                                                                           │
 * │ ⚠ The vanishing point is 1800 units ABOVE the horizon, which is far       │
 * │ outside the picture. That is what makes the visible slice read as         │
 * │ *almost* parallel: pull it closer and the floor turns into a road.        │
 * │                                                                           │
 * │ ⚠ ONE `<path>`, not 168 `<line>` elements, and built at MODULE LOAD — it  │
 * │ depends on nothing that changes, so it costs nothing per render and       │
 * │ nothing per frame.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const FAN_DEPTH = 1000;

const PLANK_PATH = ((): string => {
  const cx = WORLD.w / 2;
  const vy = HORIZON - FAN_DEPTH;
  const bottom = WORLD.h + BLEED;
  // How much the fan has spread by the time it reaches the bottom of the bleed.
  const spread = (bottom - vy) / (HORIZON - vy);
  const half = WORLD.w / 2 + BLEED;
  const out: string[] = [];
  for (let dx = -half; dx <= half; dx += PLANK_W) {
    out.push(`M${(cx + dx).toFixed(1)} ${HORIZON}L${(cx + dx * spread).toFixed(1)} ${bottom}`);
  }
  return out.join('');
})();

/**
 * One floor object, anchored by its FOOTPRINT — `(x, baseY)` is the point where
 * it meets the floor, centred. Same convention as a person's feet, so a chair
 * and the person on it are placed by the same kind of coordinate.
 */
function Furn({
  id,
  x,
  baseY,
  flip,
  only,
}: {
  id: keyof typeof FURNITURE;
  x: number;
  baseY: number;
  flip?: boolean;
  /**
   * ⚠ A `front` piece splits: its ART goes to the layer above the people, its
   * SHADOW stays in the room below them. That is not a compromise — a shadow is
   * ON THE FLOOR, so somebody standing over it should cover it, while the table
   * casting it should not be covered. Keeping the pair together would put a
   * smudge on top of the person's shoes.
   */
  only?: 'shadow' | 'art';
}) {
  const p: Piece = FURNITURE[id];
  const w = widthOf(p);
  // 0.92 of the object's width, and the same 0.24 flatness the person's ellipse
  // has — a footprint is a little narrower than the widest part of the thing
  // standing on it, and the light does not change between one object and another.
  const rx = w * 0.46;
  const ry = rx * 0.24;
  return (
    <g
      // ⚠ Mirroring about the piece's OWN centre. Flipping about the origin
      // would fling it across the room.
      transform={flip ? `translate(${2 * x} 0) scale(-1 1)` : undefined}
      aria-hidden="true"
    >
      {/* Straddling the base line the way the person's does — most of it behind
          the object, a little of it in front — so the piece sits ON the floor
          rather than hovering over a smudge. */}
      {only !== 'art' && <ellipse cx={x} cy={baseY - ry * 0.36} rx={rx} ry={ry} fill={`url(#${SHADOW})`} />}
      {only !== 'shadow' && <image href={p.src} x={x - w / 2} y={baseY - p.h} width={w} height={p.h} />}
    </g>
  );
}

/**
 * 🔴 `RoomFront` IS GONE — a whole SECOND `<svg>` above the people, deleted.
 * → SPEC-office-animation.md §17b
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT DREW THE CHESS SET OVER EVERYBODY AND SORTED BY NOTHING.              │
 * │                                                                          │
 * │ That was right for exactly one object and wrong for the three things this │
 * │ round asks for — a desk people stand on both sides of, two workers who    │
 * │ overlap, and one assistant who must beat everyone. Three front layers is  │
 * │ three mechanisms answering one question, and they disagree the first time │
 * │ somebody walks between two of them.                                      │
 * │                                                                          │
 * │ The pieces it held moved into `.office-stage` — the SAME layer as the     │
 * │ people, at the same world coordinates — and everything there sorts on     │
 * │ `z-index = round(baseY)`. → `DomScene.tsx §Prop`                          │
 * │                                                                          │
 * │ ⚠ THE SHADOWS DID NOT MOVE. They are still painted here, in the room,     │
 * │ under everybody's shoes, by the `only="shadow"` split below.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * 🔴 THE BOOT CHECK THE SEAT RULE CANNOT MAKE FOR ITSELF.
 *
 * `CHESS_SEAT` puts the player forward of their stool by more than the largest
 * `sitLift`, so the lifted drawing's feet still land BEHIND the table's top edge
 * and are occluded by it. Half that arithmetic is in `core` (the seat, the lift
 * ceiling) and half is here (the table's drawn height) — this is the only place
 * both halves are visible, so this is where the promise is turned into a throw.
 *
 * ⚠ The failure it catches is silent and slow: feet drawn standing on the chess
 * pieces, which reads as an art bug and gets looked for in the sprite sheet.
 */
const chessTable = BREAK_PIECES.find((p) => p.id === 'table-chess');
if (chessTable) {
  const tableTop = chessTable.baseY - FURNITURE['table-chess'].h;
  const lowestFoot = CHESS_SEAT.y - MAX_SIT_LIFT;
  if (lowestFoot <= tableTop) {
    throw new Error(
      `Room: a lifted chess player's feet reach ${lowestFoot}, above the table top ${tableTop} — they would stand on the board`,
    );
  }
}

/** One wall object, anchored by its CENTRE — it hangs, it does not stand. */
function Wall({ id, x, cy }: { id: keyof typeof WALL; x: number; cy: number }) {
  const p: Piece = WALL[id];
  const w = widthOf(p);
  return <image href={p.src} x={x - w / 2} y={cy - p.h / 2} width={w} height={p.h} aria-hidden="true" />;
}

export const Room = memo(function Room({
  armCount,
  libraryCount,
  onOpen,
}: {
  armCount: number;
  libraryCount: number;
  onOpen(what: 'library' | 'artifacts'): void;
}) {
  const shelf = STATIONS.library;
  const bench = STATIONS.arm;
  const desk = STATIONS.artifacts;
  const floor = (s: { y: number; h: number }) => s.y + s.h;

  return (
    <g className="room">
      {/* One gradient, referenced by every floor object. Soft by GRADIENT and
          never by `filter: blur()`, exactly as `.actor-shadow` is: a blur costs
          an offscreen buffer, and this layer is drawn once and kept. */}
      <defs>
        {/* ⚠ 0.22 / 0.09, matching `.actor-shadow` exactly. Both dropped from
            0.34 / 0.14 when the floor stopped being the page colour (#fbfaf8)
            and became a real floor (#eae6e0) — the same alpha on a darker ground
            reads a third heavier. Two shadow recipes in one room is two light
            sources, so these two numbers move together or not at all. */}
        <radialGradient id={SHADOW}>
          <stop offset="0" stopColor="#241d14" stopOpacity="0.22" />
          <stop offset="0.62" stopColor="#241d14" stopOpacity="0.09" />
          <stop offset="1" stopColor="#241d14" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── the shell. Everything here runs to ±BLEED so the letterbox bars fill
             with the surface beside them instead of with the page. */}
      <rect className="wall" x={-BLEED} y={-BLEED} width={WORLD.w + BLEED * 2} height={HORIZON + BLEED} />
      <rect
        className="floor"
        x={-BLEED}
        y={HORIZON}
        width={WORLD.w + BLEED * 2}
        height={WORLD.h - HORIZON + BLEED}
      />
      <path className="plank" d={PLANK_PATH} />
      {/* The baseboard belongs to the WALL — it is the bottom 16 units of it, not
          a line drawn on the floor. Anything standing in front of it overlaps it,
          which is what the black stroke it replaces could never do. */}
      <rect className="baseboard" x={-BLEED} y={HORIZON - 16} width={WORLD.w + BLEED * 2} height={16} />

      {/* ── the back wall. It is 40% of the room's height and used to carry one
             window and nothing else, which is most of why the room read as a
             hall. → SPEC-office-art.md §3 */}
      <Wall id="window" x={700} cy={166} />
      <Wall id="whiteboard" x={950} cy={172} />
      <Wall id="clock" x={520} cy={92} />
      <Wall id="pinboard" x={1330} cy={168} />
      <Wall id="picture" x={430} cy={186} />
      <Wall id="shelf" x={1520} cy={244} />
      <Wall id="plant-hanging" x={840} cy={106} />

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
        {/* ⚠ 92 units apart, not 130. These two are ONE piece of furnishing —
            the place documents live — and a gap wide enough to walk through
            made them two unrelated objects that happened to share a label. */}
        <Furn id="bookcase" x={shelf.x + 62} baseY={floor(shelf)} />
        <Furn id="cabinet" x={shelf.x + 154} baseY={floor(shelf)} />
      </Station>

      {/* ── the arm bench. Nothing plugged in ⇒ dimmed and DASHED, the diagram's
             own vocabulary for "nothing is wired here". It does not disappear:
             a floor plan that changes shape per office is a floor plan nobody
             can learn. */}
      {/*
        ┌──────────────────────────────────────────────────────────────────────┐
        │ 🔴 NO `onOpen`, AND THAT IS THE WHOLE CHANGE. → SPEC §17i            │
        │                                                                      │
        │ It used to open `arms[0]`'s Inspector. There is ONE bench and there  │
        │ are N connections, so "the nearest one" was a coin toss wearing a    │
        │ rule: with two arms plugged in, half of every click opened the wrong │
        │ panel and the user had no way to aim.                                │
        │                                                                      │
        │ ⚠ The bench does NOT disappear, and neither does its label — it      │
        │ still says how many connections this office has, which is a fact     │
        │ worth reading. `Station` with no handler renders a plain group: no   │
        │ `role`, no `tabIndex`, no `title` promising a door. A control that   │
        │ takes focus and does nothing is worse than a picture.                │
        └──────────────────────────────────────────────────────────────────────┘
      */}
      <Station
        label={armCount ? plural('office.armCount', armCount) : t('office.armNone')}
        x={bench.x}
        y={bench.y}
        w={bench.w}
        h={bench.h}
        muted={armCount === 0}
      >
        {/* A laptop, not a bare desk: the station has to say what happens here,
            and the label used to be carrying that meaning alone.
            ⚠ The office swivel chair that stood beside it is GONE. Nobody sits
            at this bench — §5 makes the break area the only place with seats,
            and `pose: 'sit'` is only ever set there — so an empty chair next to
            it read as an absence rather than as furniture. */}
        {/* ⚠ SHADOW ONLY. The desk's ART is in `DESK_PIECES`, drawn in the actor
            layer so somebody standing behind it is covered by it. → §17b */}
        <Furn id="desk-laptop" x={bench.x + bench.w / 2} baseY={floor(bench)} only="shadow" />
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
        {/* Longer than the bench's desk and loaded with paperwork — the two
            working stations are no longer the same drawing twice. 292 units
            wide against a 268-unit station: it overhangs slightly on purpose,
            because the desk is the thing being pointed at, not the rectangle.
            ⚠ SHADOW ONLY — see the arm bench above. */}
        <Furn id="desk-files" x={desk.x + desk.w / 2} baseY={floor(desk)} only="shadow" />
      </Station>

      {/* ── the break area. The only place with seats, and the only place
             anybody sits. → §5a · SPEC-office-art.md §5

             ⚠ NOT A LIST OF LITERALS ANY MORE. Every position comes from
             `BREAK_PIECES`, which is the same table `BREAK_SEATS` is derived
             from — the two used to be written independently here and there, and
             they drifted by up to 130 units the first time the area moved. */}
      <g className="break-area" aria-hidden="true">
        {/* rx 28, and no stroke at all — a softened patch of a different floor,
            not a card. → `office.css §.rug` */}
        <rect className="rug" x={BREAK_AREA.x} y={BREAK_AREA.y} width={BREAK_AREA.w} height={BREAK_AREA.h} rx={28} />
        <text className="break-label" x={BREAK_AREA.x + 16} y={BREAK_AREA.y + 26}>
          {t('office.breakArea')}
        </text>
        {/* ⚠ EVERY piece's shadow is painted here, `front` ones included — a
            shadow is on the floor and belongs under the people. Only the ART of
            a `front` piece moves up to `RoomFront`. */}
        {BREAK_PIECES.map((p, i) => (
          <Furn
            key={`${p.id}-${i}`}
            id={p.id}
            x={p.x}
            baseY={p.baseY}
            {...(p.sorted ? { only: 'shadow' as const } : {})}
          />
        ))}
      </g>

      {/* ── dressing, on no station and in nobody's way.
             ⚠ ONE potted plant in the whole room, and it is this one. A second
             one in the break area made the right-hand side read as the subject
             of the picture, which is the same thing the wandering did.
             ⚠ The cooler stands at the SEAM between the work half and the rest
             half. At 1492 it was inside the break area's column and overlapped
             the wall shelf above it. It sits 48 units off the wall rather than
             20: pressed against the baseboard it read as MOUNTED, the same way
             the bookshelf did before it moved — but at 80 it had walked into the
             room and stopped belonging to the wall at all.
             ⚠ BOTH COME FROM `core/office-floor`, and they used to be literals
             right here — a second copy of a layout whose first copy decides
             where somebody stands beside them. That pair has drifted in this
             room once already (`BREAK_PIECES`), and this time the drift would
             be a person standing in front of nothing. */}
      <Furn id="cooler" x={COOLER.x} baseY={COOLER.baseY} />
      <Furn id="plant" x={PLANT.x} baseY={PLANT.baseY} />
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
  /** Both absent ⇒ this station is FURNITURE WITH A CAPTION, not a door. */
  hint?: string;
  onOpen?: () => void;
  x: number;
  y: number;
  w: number;
  h: number;
  muted?: boolean;
  children: React.ReactNode;
}) {
  const door = !!onOpen;
  return (
    <g
      className={`station${door ? '' : ' is-inert'}${muted ? ' is-muted' : ''}`}
      // ⚠ Every interactive attribute is conditional TOGETHER. Half of them —
      // a `tabIndex` with no handler, a `role="button"` that answers nothing —
      // is a control a screen reader announces and a keyboard cannot use.
      {...(door
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `${label} — ${hint}`,
            onClick: onOpen,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            },
          }
        : { 'aria-hidden': true })}
    >
      <title>{door ? `${label} — ${hint}` : label}</title>
      {children}
      <text className="station-label" x={x + w / 2} y={y + h + 24} textAnchor="middle">
        {label}
      </text>
      {/* One generous hit area rather than per-shape hit testing: a click that
          lands between two books must still open the library.
          ⚠ An inert station has none: an invisible rectangle that eats clicks and
          answers nothing is the worst of both. */}
      {door && (
        <rect className="station-hit" x={x - 12} y={y - 12} width={w + 24} height={h + 48} rx={8} />
      )}
    </g>
  );
}
