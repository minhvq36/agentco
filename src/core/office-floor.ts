/**
 * THE FLOOR PLAN, AND THE RULE THAT DECIDES WHO STANDS WHERE.
 * → docs/SPEC-office-animation.md §5 · §6e · §14
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS LIVES IN `core/` AND NOT IN THE INTERFACE.                      │
 * │                                                                          │
 * │ Two reasons, and the second is the heavier one:                          │
 * │                                                                          │
 * │  1. It is PURE — no DOM, no React, no drawing. Same as                   │
 * │     `layout-geometry.ts`, which the interface already imports through    │
 * │     `@core` for exactly this reason: two copies of one table drift.      │
 * │                                                                          │
 * │  2. 🔴 `direct()` IS THE HONESTY LAYER, and it was living inside a       │
 * │     `useEffect`. A rule that decides *"this worker walks to the          │
 * │     bookshelf"* is a rule that can state something that never happened,  │
 * │     and it was sitting in the one place `node --test` cannot reach.      │
 * │     This repository has already written that lesson down once —          │
 * │     *"when an important rule lives in a function no test can touch, the  │
 * │     real debt is the SHAPE OF THE CODE, not the missing test"* (the      │
 * │     `buildPlan` case). Same shape, same fix.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE — no `node:*`, no disk, no `process`.
 */

import { MAX_SIT_LIFT, hash32 } from './cast.js';
import type { WorkPlace } from './types.js';

export interface Point {
  x: number;
  y: number;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ TWO KINDS OF NUMBER LIVE IN THIS FILE, AND THEY DO NOT SCALE TOGETHER. │
 * │                                                                          │
 * │   ROOM numbers   how big the place is and where its furniture sits.      │
 * │                  `WORLD`, `HORIZON`, `STATIONS`, `BREAK_AREA`,           │
 * │                  `ASSISTANT_SPOT`, the origin of `ownSpot`.              │
 * │   BODY numbers   how much space one PERSON needs. `CH_H`, the ring-slot  │
 * │                  offsets, `COL`/`ROW`.                                   │
 * │                                                                          │
 * │ On 06/09 the room read as a HALL: 1600 units is twelve people side by    │
 * │ side. Only the RATIO matters, so there were two ways to fix it — shrink  │
 * │ the room, or grow the people. **The people grew** (133 → 177), and the   │
 * │ room did not move.                                                       │
 * │                                                                          │
 * │ 🔴 SHRINKING THE ROOM WAS TRIED FIRST AND IS WRONG, for a reason that is │
 * │ invisible from a screenshot: the floor is not scenery, it is where TEN   │
 * │ PEOPLE STAND. At 0.75 the world became 675 tall while `ownSpot` still    │
 * │ put its third row at y=714 — the last four employees fell off the floor. │
 * │ A room is sized by the cast it has to hold, not by how full it looks.    │
 * │                                                                          │
 * │ ⚠ And BODY numbers scale WITH the body: `ringSlots` moved 92 → 122 and   │
 * │ `COL`/`ROW` grew with it. Leaving them behind is how two people at one   │
 * │ station end up standing inside each other. `PER_ROW` went 4 → 5 because  │
 * │ taller rows fit fewer of themselves in the same floor.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const WORLD = { w: 1600, h: 900 };

/**
 * Feet-to-head. EVERYTHING else in the room is sized against this.
 *
 * ⚠ It went 70 → 133 when the cast stopped being chibi, and the furniture had
 * to follow in the same change. A 70-unit person in a 1600-unit room is
 * twenty-three people wide — that is a warehouse, and it is why the first cut
 * read as toys scattered on a floor rather than as an office.
 */
export const CH_H = 177;

/** The back wall meets the floor here. Anything against the wall has its base on it. */
export const HORIZON = 360;

export type StationId = 'library' | 'artifacts' | 'arm';

export interface Station {
  id: StationId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY EACH STATION IS WHERE IT IS — none of it is decoration.              │
 * │                                                                          │
 * │ BOOKSHELF back-LEFT   the least dynamic station, and the left edge is    │
 * │                       what the sidebar overlays (§11b)                   │
 * │ ARM BENCH  front-LEFT the only station that reaches OUTSIDE the office.  │
 * │                       It used to sit against the back wall on the RIGHT; │
 * │                       the break area took that half of the room, and     │
 * │                       parking it mid-wall left the front-left quarter    │
 * │                       empty while the back row carried three objects.    │
 * │ FILING DESK mid-right within a short walk of the assistant, because the  │
 * │                       hand-off beat between them is the one moment a     │
 * │                       worker really does report back (§6d)               │
 * │ ASSISTANT  centre-front, facing the viewer: its counterpart is the USER, │
 * │                       not the workers. It never walks — with three tasks │
 * │                       running at once it would have to be in three       │
 * │                       places, and the person you talk to must not be     │
 * │                       something you have to hunt for.                    │
 * │ BREAK AREA the whole RIGHT side, the only place with chairs              │
 * │                                                                          │
 * │ The shared knowledge store is DELIBERATELY not a station. It has no      │
 * │ wires on the diagram for the same reason — it is the environment, not a  │
 * │ relationship — and a shelf nobody ever walks to would teach the opposite.│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ 06/09: TWO STATIONS CAME OFF THE BACK WALL.                             │
 * │                                                                           │
 * │ Both used to end their rectangle exactly at `HORIZON`, which is where     │
 * │ the wall meets the floor — so their footprint sat ON the junction and     │
 * │ the shelf read as MOUNTED TO THE WALL rather than standing in front of    │
 * │ it. A hard black line drawn along that junction was doing half the        │
 * │ damage; it is a baseboard band now (§office.css). The other half was the  │
 * │ furniture, and it moved 44 units into the room.                           │
 * │                                                                           │
 * │ ⚠ THE COST, STATED: `ringSlots` reaches 104 units past the rectangle, so  │
 * │ the library's SIXTH slot now lands ~30 units from `ownSpot(1)`. It is     │
 * │ reachable only with six people reading documents at once in an office     │
 * │ that also has somebody standing at their own spot — seven employees       │
 * │ minimum. Accepted knowingly; the near-miss existed before the move        │
 * │ (56 × 48 units) and this makes it tighter, not new.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const STATIONS: Record<StationId, Station> = {
  library: { id: 'library', x: 176, y: 196, w: 214, h: 208 },
  arm: { id: 'arm', x: 120, y: 620, w: 312, h: 116 },
  artifacts: { id: 'artifacts', x: 790, y: 432, w: 292, h: 116 },
};

/** Centre-front. The assistant stands here and does not leave. */
export const ASSISTANT_SPOT: Point = { x: 596, y: 838 };

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 WORK ON THE LEFT, REST ON THE RIGHT — and the two stations MOVED for  │
 * │ it, which is the expensive half of this decision.                        │
 * │                                                                          │
 * │ The break area used to be the bottom-right corner. Growing it up the      │
 * │ whole right side walked it into two stations, and NOT because their       │
 * │ rectangles overlapped — because their STANDING SLOTS did. Measured        │
 * │ against `ringSlots()` before anything moved:                             │
 * │                                                                          │
 * │   arm        rect sat ABOVE the horizon and looked clear. All SIX of its │
 * │              slots (x 1049…1479, y 394…498) landed on the rug.           │
 * │   artifacts  rect overlapped by 182 units; four of six slots inside.     │
 * │                                                                          │
 * │ ⚠ A station's footprint is not where it costs floor. The ring is, and it │
 * │ reaches 104 units further down and 59 further out on each side than the  │
 * │ rectangle anyone looks at.                                              │
 * │                                                                          │
 * │ `ownSpot()` was deliberately NOT touched: its arc spans x 46…994, which  │
 * │ was already clear. A layout change that also re-tunes the thing it did   │
 * │ not have to touch is a layout change nobody can bisect.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ 420 wide, not the full 550 the right edge would allow. The work half has to
 * hold ten home spots, three station rings and the assistant inside what is left,
 * and 1600 units is not generous once 550 of them are gone.
 */
export const BREAK_AREA = { x: 1170, y: 376, w: 400, h: 502 };

/**
 * 🔴 EVERY OBJECT IN THE BREAK AREA — AND THE SEATS ARE DERIVED FROM THEM.
 * → docs/SPEC-office-art.md §5
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE FURNITURE AND THE SEATS ARE ONE TABLE, BECAUSE THEY WERE TWO AND  │
 * │ THEY DRIFTED — SILENTLY, AND WITHIN ONE CHANGE.                          │
 * │                                                                          │
 * │ The pieces were placed by literals in `Room.tsx`, the seats by literals  │
 * │ here. Both were written against the OLD 546-wide corner rug. When the    │
 * │ area moved to the right-hand wall at 400 wide, the two halves failed in  │
 * │ different directions and neither made a sound:                           │
 * │                                                                          │
 * │   the chess set   drawn at x 1590 in a 1600-unit world — off the floor   │
 * │   its seat        1460, so the sitter rested beside furniture that was   │
 * │                   not there                                              │
 * │   the sofa        drawn at 1486, cushions at 1403 and 1477               │
 * │                                                                          │
 * │ Two copies of one layout WILL drift. A seat is defined by the PIECE it   │
 * │ belongs to now, so moving the sofa moves the people sitting on it and    │
 * │ there is no second number to forget.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface BreakPiece {
  /** The key in `web/src/office/art/furniture.ts`. Checked by `tsc` at the call site. */
  id: 'counter' | 'foosball' | 'sofa' | 'stool' | 'table-chess' | 'table-low';
  /** Centre of the footprint. */
  x: number;
  /** Where the footprint meets the floor — same convention as a person's feet. */
  baseY: number;
  /**
   * 🔴 DRAWN IN FRONT OF THE PEOPLE. → docs/SPEC-office-art.md §3
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ THE ROOM HAS EXACTLY ONE OF THESE, AND THAT IS THE WHOLE DESIGN.        │
   * │                                                                           │
   * │ Furniture is an `<svg>` and people are an HTML layer stacked on top of    │
   * │ it, so by construction nothing can occlude anybody. The chess table is    │
   * │ the one object where that reads as broken rather than as flat: the        │
   * │ player sits BEHIND it, so a body drawn over the board is a body standing  │
   * │ in the middle of the game.                                                │
   * │                                                                           │
   * │ ⚠ IT IS NOT A GENERAL DEPTH SYSTEM AND MUST NOT BECOME ONE. A front       │
   * │ layer sorts by nothing — every piece in it beats every person, whatever   │
   * │ their `y`. That is correct for a table only ever approached from behind;  │
   * │ apply it to the sofa and somebody walking in front of it disappears       │
   * │ behind the backrest. Real depth needs a per-frame sort of two layers      │
   * │ that do not share a coordinate system, and nothing here is worth that.    │
   * │                                                                           │
   * │ ⇒ Adding a second `front` piece is a DESIGN decision, not a tweak: it     │
   * │ must be an object people only ever stand behind.                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  front?: boolean;
}

/**
 * ⚠ THE COUNTER IS AGAINST THE RIGHT WALL AND THE SOFA IS ON THE INSIDE — the
 * two swapped on 06/09, and it is not symmetry for its own sake. The counter is
 * a SERVICE object: you walk to it, take a cup, and leave. The sofa is where you
 * stay. Putting the thing people sit at on the outer edge pushed the whole
 * seating group into the wall and left the traffic side of the area empty.
 *
 * ⚠ And nothing anchors in the top-left corner. `office.breakArea` is painted at
 * `(x + 16, y + 26)`; a 120-unit counter anchored 120 units down covered it, and
 * the area announced itself with the first four characters of its name missing.
 * A caption a piece of furniture can stand on is a caption nobody has placed.
 */
const SOFA = { x: BREAK_AREA.x + 100, baseY: BREAK_AREA.y + 150 };
// 56 units below the sofa, not 68. The pair has to read as ONE seating group;
// any further and the table belongs to the room rather than to the sofa.
const LOW_TABLE = { x: SOFA.x, baseY: SOFA.baseY + 56 };
const COUNTER = { x: BREAK_AREA.x + 300, baseY: BREAK_AREA.y + 140 };
const CHESS = { x: BREAK_AREA.x + 70, baseY: BREAK_AREA.y + 450 };
// ⚠ 84, and the number was walked in: 98 put the far stool's feet exactly on the
// table's top edge and it read as a stool STANDING ON THE BOARD; 120 opened a strip
// of floor wide enough that the stool stopped belonging to the table; 100 was still
// reading as *near* the table rather than *at* it. The gap has to be visible and
// small, and the seat follows the stool because it is derived from it.
const CHESS_FAR = { x: CHESS.x, baseY: CHESS.baseY - 60 };
const CHESS_NEAR = { x: CHESS.x, baseY: CHESS.baseY + 36 };
// ⚠ Pushed right, away from the chess set: two game tables 170 units apart read
// as one cluttered corner. 210 apart, each is its own thing. It cannot go further
// — its RIGHT-hand player would stand past the edge of the floor patch.
const FOOSBALL = { x: BREAK_AREA.x + 280, baseY: BREAK_AREA.y + 470 };

/**
 * ⚠ ARRAY ORDER IS PAINTER'S ORDER. The far stool is drawn before the chess
 * table and the near stool after it, which is the only reason the set reads as
 * a table with a seat on each side rather than three objects in a stack.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ THE CHESS TABLE AND ITS NEAR STOOL ARE THE ROOM'S ONLY `front` PIECES. │
 * │                                                                          │
 * │ Everything else in the room is drawn under the people, because the       │
 * │ furniture is an `<svg>` and the people are an HTML layer on top of it.   │
 * │ That is fine for every object anyone can walk in front of. It is wrong   │
 * │ for this one: the player sits BEHIND the board, so a body drawn over the │
 * │ board is a body standing in the middle of the game.                      │
 * │                                                                          │
 * │ ⚠ AND THE TABLE STILL SITS 84 UNITS BELOW ITS OWN FAR STOOL. That was    │
 * │ originally a workaround for having no front layer — the board had to     │
 * │ clear the sitter to stay visible at all. It is kept as COMPOSITION: in a │
 * │ front-above view a nearer object IS drawn lower, and the drop is what    │
 * │ leaves the far stool readable as a seat when nobody is on it.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const BREAK_PIECES: readonly BreakPiece[] = [
  { id: 'counter', ...COUNTER },
  { id: 'sofa', ...SOFA },
  { id: 'table-low', ...LOW_TABLE },
  { id: 'stool', ...CHESS_FAR },
  { id: 'table-chess', ...CHESS, front: true },
  { id: 'stool', ...CHESS_NEAR, front: true },
  { id: 'foosball', ...FOOSBALL },
];

/**
 * 🔴 THE CHESS PLAYER STANDS FORWARD OF THE STOOL, NOT ON ITS BASE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 34, AND EVERY UNIT OF IT IS PAYING FOR SOMETHING.                        │
 * │                                                                          │
 * │ At +4 the seated figure's feet landed in the band the chess PIECES are   │
 * │ drawn in, and the user saw them standing on the board. Two things pushed │
 * │ them there, and only one is obvious:                                     │
 * │                                                                          │
 * │  · a person sitting on a stool plants their feet FORWARD of its legs —   │
 * │    +4 was never right, it was the stool's own base wearing a seat's name │
 * │  · `sitLift` (art/manifest.ts) raises the seated DRAWING by up to        │
 * │    `MAX_SIT_LIFT` world units without moving the anchor, so the visible  │
 * │    feet sit that much higher than this coordinate says                   │
 * │                                                                          │
 * │ ⇒ forward by MORE than the largest lift, so even the most-lifted sheet's │
 * │ feet still land behind the table's top edge and are occluded by it.      │
 * │                                                                          │
 * │ ⚠ THE CHECK IS NOT HERE, because half of it is not here: the table's own │
 * │ height lives in `art/furniture.ts`. `Room.tsx` throws at load if this    │
 * │ ever stops holding — the only place both numbers are visible at once.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const CHESS_SEAT: BreakSeat = {
  x: CHESS_FAR.x,
  y: CHESS_FAR.baseY + MAX_SIT_LIFT + 4,
  pose: 'sit',
};

/**
 * 🔴 THE SIX PLACES SOMEBODY RESTS. Fixed points, not a capacity.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOBODY IN THE BREAK AREA MOVES, AND THE REASON IS NOT TIDINESS.          │
 * │                                                                          │
 * │ Movement is this room's only vocabulary for WORK. A figure crossing the  │
 * │ floor means something is happening. `breakSpot()` used to re-roll a      │
 * │ random point every 6–14 s, which spent that signal on nothing and made   │
 * │ an idle office look busy — the one thing this view exists to be honest   │
 * │ about.                                                                   │
 * │                                                                          │
 * │ ⚠ THE POSE BELONGS TO THE SEAT, NOT TO THE PERSON. A sofa cushion means  │
 * │ `sit` whoever is on it, and the foosball ends mean `stand`. Carrying the │
 * │ pose on the person is how somebody ends up sitting in mid-air beside a   │
 * │ table.                                                                   │
 * │                                                                          │
 * │ ⚠ ORDER IS FILL ORDER. Sofa first because one person resting should look │
 * │ like resting; foosball LAST because a single figure at a foosball table  │
 * │ is a person with no opponent, and that only happens at exactly five.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ The chess table is drawn with TWO stools and seats ONE. The far stool is
 * where the player sits — Rule 1 of the art spec (the face is visible in every
 * frame) rules out the near one, which would face away. The empty stool opposite
 * is what makes the object read as a chess table rather than a side table.
 *
 * ⚠ The counter's place is offset to the RIGHT of centre, not squarely in front.
 * A person is taller than the counter and wider than half of it, so dead-centre
 * erases the whole object; standing at its right-hand end leaves the coffee
 * machine — the thing that says what the counter is — visible past their shoulder.
 */
export interface BreakSeat extends Point {
  pose: 'stand' | 'sit';
}

export const BREAK_SEATS: readonly BreakSeat[] = [
  { x: SOFA.x - 37, y: SOFA.baseY, pose: 'sit' }, // sofa, left cushion
  { x: SOFA.x + 37, y: SOFA.baseY, pose: 'sit' }, // sofa, right cushion
  CHESS_SEAT, // chess, far stool — forward of it, see above
  { x: COUNTER.x + 40, y: COUNTER.baseY + 24, pose: 'stand' }, // at the counter
  { x: FOOSBALL.x - 78, y: FOOSBALL.baseY - 6, pose: 'stand' }, // foosball, left end
  { x: FOOSBALL.x + 78, y: FOOSBALL.baseY - 6, pose: 'stand' }, // foosball, right end
];

/**
 * 🔴 SIX IS THE WHOLE ANSWER. THE SEVENTH RESTING PERSON IS NOT DRAWN.
 * → docs/SPEC-office-art.md §5 (user's decision, 06/09)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS COSTS SOMETHING, AND THE COST IS WRITTEN DOWN RATHER THAN HIDDEN.    │
 * │                                                                           │
 * │ Two alternatives were built and rejected. Overflow WANDERING is the one   │
 * │ this file just removed — a spot re-rolled on a timer spends the room's    │
 * │ only signal for work on nothing. Overflow STANDING in a fixed back row    │
 * │ keeps everybody on screen, but seven bodies in a 400-unit strip is a      │
 * │ crowd, and a crowd in the corner makes the break area the SUBJECT of the  │
 * │ picture — which is the same failure the wandering caused, arriving by a   │
 * │ tidier road.                                                              │
 * │                                                                           │
 * │ ⚠ So absence now looks identical to non-existence for the seventh person  │
 * │ onward, and that is a real loss. It is bounded by two things: the         │
 * │ DIAGRAM still shows every employee and still says "resting" beside them   │
 * │ — the office is a second view of one office, never the only one — and     │
 * │ the room's spoken summary counts everybody who is resting, drawn or not.  │
 * │                                                                           │
 * │ ⚠ AND IT IS A FLAG, NOT AN OMISSION. `direct()` returns a placement for   │
 * │ every person and marks this one `hidden`. Dropping them from the list     │
 * │ instead would make "resting, off screen" and "not in this office" the     │
 * │ same shape of data — and absence is not a signal.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const BREAK_CAPACITY = BREAK_SEATS.length;

/**
 * Which station a place sends somebody to. → SPEC-office-animation §6e
 *
 * ⚠ Three places map to NO STATION on purpose:
 *  · `knowledge` — the shared store is the environment, not an object.
 *  · `web` / `shell` — real, and both reach OUTSIDE the office. The arm bench
 *    means "a connection the user plugged in and can unplug", which these are
 *    not; and inventing a window would teach a symbol that appears nowhere
 *    else in the product. They work from where they stand, with a glyph.
 */
export const STATION_OF: Record<WorkPlace, StationId | undefined> = {
  library: 'library',
  artifacts: 'artifacts',
  arm: 'arm',
  knowledge: undefined,
  desk: undefined,
  web: undefined,
  shell: undefined,
};

/**
 * Where somebody stands at a station: a RING of slots in front and to the
 * sides — never behind, so nobody ever turns their back to the viewer.
 */
export function ringSlots(s: Station): Point[] {
  const cx = s.x + s.w / 2;
  const foot = s.y + s.h + 34;
  return [
    { x: cx, y: foot + 13 },
    { x: cx - 122, y: foot },
    { x: cx + 122, y: foot },
    { x: s.x - 59, y: foot + 45 },
    { x: s.x + s.w + 59, y: foot + 45 },
    { x: cx, y: foot + 104 },
  ];
}

/**
 * Picks the free slot NEAREST to where the walker is standing right now.
 *
 * Nearest, not first: it makes the approach direction depend on where somebody
 * came from, so the same trip never looks identically choreographed twice — and
 * it costs one comparison. Every slot taken ⇒ stop at the ring's edge rather
 * than stack two people on one spot.
 */
export function nearestFreeSlot(s: Station, from: Point, taken: readonly Point[]): Point {
  const slots = ringSlots(s);
  let best: Point | undefined;
  let bestD = Infinity;
  for (const slot of slots) {
    if (taken.some((p) => Math.abs(p.x - slot.x) < 1 && Math.abs(p.y - slot.y) < 1)) continue;
    const d = (slot.x - from.x) ** 2 + (slot.y - from.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = slot;
    }
  }
  return best ?? { x: s.x + s.w / 2, y: s.y + s.h + 96 };
}

/**
 * ⚠ Sized against `CH_H`, not chosen by eye. A column narrower than a person is
 * wide, or a row shorter than a person is tall, and the arc turns into a pile.
 */
const PER_ROW = 5;
const COL = 237;
const ROW = 202;

/**
 * A worker's own spot on the floor — where they stand when they are working but
 * not at any station, and where they return to when released.
 *
 * ⚠ A LOOSE ARC WITH SEEDED JITTER, NOT A GRID. A row of evenly spaced people
 * reads as furniture. The jitter is seeded from the id rather than random, so
 * nobody teleports between two paints — a random offset per render is a person
 * who cannot stand still.
 */
export function ownSpot(index: number, total: number, seed: string): Point {
  const row = Math.floor(index / PER_ROW);
  const inRow = index % PER_ROW;
  const wide = Math.min(PER_ROW, total - row * PER_ROW);
  const x = 520 - ((wide - 1) * COL) / 2 + inRow * COL;
  const y = 546 + row * ROW;
  const h = hash32(`spot:${seed}`);
  // A shallow arc: the middle of a row stands a little further back, so the row
  // curves toward the viewer at its ends instead of ruling a straight line.
  const arc = wide > 1 ? Math.cos((inRow / (wide - 1) - 0.5) * Math.PI) * 26 : 0;
  return { x: x + ((h % 41) - 20), y: y - arc + (((h >> 8) % 25) - 12) };
}

/*
 * ⚠ `breakSpot`, `idleDelay` and `breakGame` WERE HERE AND ARE GONE.
 *
 * The first two drove the wander: a seeded random point re-rolled on a 6–14 s
 * timer. `Placement.loiter`, `Stage.setLoiter` and the timer branch in the frame
 * loop went with them — a dead flag left behind is how the wandering comes back
 * in six months, wired by somebody who found a boolean that looked unused.
 *
 * `breakGame` picked which of four games somebody played and **had no caller at
 * all**. With `BREAK_SEATS` the seat itself is the answer to that question.
 */

// ────────────────────────────────────────────────────────────── the director

/** What the room knows about one person. Deliberately NOT a `CanvasNode`. */
export interface DirectAgent {
  /** The node id — the identity the whole scene uses. */
  id: string;
  /** The role id, which is what `live` is keyed by. */
  role: string;
  /** Wired from the assistant ⇒ gets given work. No wire ⇒ resting. */
  connected: boolean;
}

/** The live state of one person, narrowed to what placement actually reads. */
export interface DirectLive {
  status: 'working' | 'done' | 'error';
  /** WHERE the last tool call landed. `undefined` = no place was observed. */
  at?: WorkPlace;
  /** Files the finished task produced. Only meaningful with `status: 'done'`. */
  artifacts?: number;
}

export interface DirectInput {
  /** Absent only in the moment before the office has loaded. */
  assistantId?: string;
  /** ⚠ MUST already be in a stable order — the arc of standing spots follows it. */
  agents: readonly DirectAgent[];
  live: Readonly<Record<string, DirectLive>>;
  /** The assistant's hidden worker, if it is running. */
  reading: 'library' | 'web' | null;
  /**
   * Where somebody is standing RIGHT NOW, so a ring can pick the slot nearest
   * to them. Absent ⇒ they have not been placed yet and their home is used.
   */
  at(id: string): Point | undefined;
}

export interface Placement {
  id: string;
  target: Point;
  /** Chairs exist only in the break area, so this is the only place `sit` comes from. */
  pose: 'stand' | 'sit';
  /**
   * Resting, and whether the break area had a seat left. Absent ⇒ this person is
   * working, or standing at their own spot. → `BREAK_CAPACITY`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ ONE FIELD, TWO FACTS, AND BOTH ARE NEEDED BY DIFFERENT READERS.         │
   * │                                                                           │
   * │ The renderer asks *do I draw this person*; the spoken summary asks *how   │
   * │ many are resting*. Answer only the first and the count under-reports the  │
   * │ office; answer only the second and the renderer has to re-derive the      │
   * │ capacity rule, which is a second opinion about a number core already      │
   * │ owns.                                                                     │
   * │                                                                           │
   * │ ⚠ And `offscreen` is a STATED value, not a missing entry. Dropping the    │
   * │ person from the list would make "resting, off screen" and "not in this    │
   * │ office" the same shape of data, and absence is not a signal.              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  rest?: 'seated' | 'offscreen';
}

/**
 * WHO SHOULD BE WHERE — the whole placement rule, as one pure function.
 * → docs/SPEC-office-animation.md §6e
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOTHING HERE IS INFERRED FROM TEXT. Every branch reads a field a machine  │
 * │ wrote: `at` from the tool call, `artifacts` from the receipt, `connected` │
 * │ from the wire, `reading` from the office. `say` is never consulted — it   │
 * │ has two authors and it goes through i18n, so a rule that reads it works   │
 * │ in exactly the language it was written in.                               │
 * │                                                                          │
 * │ ⚠ `at: undefined` MEANS NO PLACE, never a default place. A turn that      │
 * │ called no tool must leave somebody exactly where they are; substituting   │
 * │ a station would make the picture claim something nobody observed.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function direct(input: DirectInput): Placement[] {
  const out: Placement[] = [];
  const taken: Point[] = [];
  /**
   * How many people are already resting, so the next one takes the next seat.
   *
   * ⚠ POSITION AMONG THE RESTING, IN THE STABLE `agents` ORDER — not a hash, and
   * not `nearestFreeSlot`. A hash collides, and two bodies on one sofa cushion is
   * worse than the cost below; "nearest" has no input here because a resting
   * person is not walking in from anywhere.
   *
   * The cost, stated rather than hidden: when somebody STOPS resting, everybody
   * behind them shifts up a seat and walks to it. That is a real limitation and
   * the fix is storage — a seat written into `layout.cast`'s neighbourhood the
   * way a face already is (§9). It is not the wandering this replaced: nothing
   * moves on a timer, and the room is still while its state is.
   */
  let resting = 0;

  const slot = (id: StationId, from: Point): Point => {
    const p = nearestFreeSlot(STATIONS[id], from, taken);
    taken.push(p);
    return p;
  };

  if (input.assistantId) {
    const from = input.at(input.assistantId) ?? ASSISTANT_SPOT;
    /**
     * The assistant walks for EXACTLY ONE reason: its hidden worker is reading
     * documents. Everything else — thinking, planning, searching the web,
     * reporting — happens at centre-front, facing the viewer. §6d
     */
    out.push({
      id: input.assistantId,
      target: input.reading === 'library' ? slot('library', from) : ASSISTANT_SPOT,
      pose: 'stand',
    });
  }

  input.agents.forEach((agent, i) => {
    const state = input.live[agent.role];
    const home = ownSpot(i, input.agents.length, agent.id);
    const from = input.at(agent.id) ?? home;

    // Resting = on the diagram but not wired, and not currently working. The
    // same source the diagram already prints the word "resting" from, so the
    // two views cannot disagree.
    if (!agent.connected && !state) {
      const seat = BREAK_SEATS[resting++];
      // Past the sixth seat: still resting, still counted, simply not drawn. The
      // target is their own spot so that the day they stop resting they are
      // already where they belong rather than sliding in from a corner.
      if (!seat) {
        out.push({ id: agent.id, target: home, pose: 'stand', rest: 'offscreen' });
        return;
      }
      out.push({ id: agent.id, target: { x: seat.x, y: seat.y }, pose: seat.pose, rest: 'seated' });
      return;
    }

    if (state?.status === 'working') {
      const station = STATION_OF[state.at ?? 'desk'];
      out.push({
        id: agent.id,
        target: station ? slot(station, from) : home,
        pose: 'stand',
      });
      return;
    }

    /**
     * The hand-off beat: a finished task WITH files to show walks them to the
     * filing desk and puts them down. With nothing to put down (a
     * `deliver: reply` task) it hands off from where it stands.
     *
     * No timer ends the beat — the display clears `done` on its own after a few
     * seconds, and the next call of this function sends them home. One
     * lifetime, one owner.
     */
    if (state?.status === 'done' && (state.artifacts ?? 0) > 0) {
      out.push({ id: agent.id, target: slot('artifacts', from), pose: 'stand' });
      return;
    }

    out.push({ id: agent.id, target: home, pose: 'stand' });
  });

  return out;
}
