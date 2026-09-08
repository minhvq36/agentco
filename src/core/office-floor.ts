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
  /**
   * 🔴 WHERE THIS OBJECT IS ACTUALLY USED FROM. Tried first; the ring is
   * overflow. → `usedFrom` · docs/SPEC-office-animation.md §17f′
   *
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ MEASURED 08/09, AND THE PICTURE WAS BACKWARDS.                       │
   * │                                                                      │
   * │ `nearestFreeSlot` answers *"which slot is closest to the walker"*,   │
   * │ and workers arrive from the floor — from the right and below. So the │
   * │ person READING documents was sent to (449, 483), which is 88 units   │
   * │ past the cabinet's right edge, while an IDLE colleague stood at      │
   * │ (292, 462), right in front of it. The one using the object stood     │
   * │ further from it than the one doing nothing.                          │
   * │                                                                      │
   * │ ⚠ NEAREST IS STILL RIGHT FOR THE SECOND PERSON ONWARDS. Varying the  │
   * │ approach is what keeps two trips from being choreographed identically│
   * │ (§5b) — it was only ever wrong as the answer for the FIRST one.      │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  use?: UsePlace;
}

/**
 * Which side of its object a station is used from.
 *
 * `front`  in front of it, dead centre — the ring's own first slot, so this
 *          adds a PREFERENCE and not one new coordinate.
 * `behind` the far side of a desk, where somebody typing at it stands. The desk
 *          is a sorted piece, so it is drawn over them and they read as being
 *          AT it rather than in front of it. → `BEHIND_DESK` · §17b
 */
export type UsePlace = 'front' | 'behind';

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
  library: { id: 'library', x: 176, y: 196, w: 214, h: 208, use: 'front' },
  arm: { id: 'arm', x: 120, y: 620, w: 312, h: 116, use: 'behind' },
  /**
   * ⚠ NO `use`, AND THE ABSENCE IS A DECISION. This is the only station with a
   * crowd — every finished task with files walks here (§6d) — so the ring's
   * spread is doing real work, and the user has not reported it standing
   * anybody in the wrong place. Giving all three a primary place because two of
   * them needed one is a change nobody asked for on the busiest object.
   */
  artifacts: { id: 'artifacts', x: 790, y: 432, w: 292, h: 116 },
};

/** Centre-front. Where the assistant is standing every time the view opens. */
export const ASSISTANT_SPOT: Point = { x: 596, y: 838 };

/**
 * 🔴 THE ASSISTANT'S SECOND PLACE: WAITING FOR A RECEIPT.
 * → docs/SPEC-office-animation.md §17d
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ §6d SAID "THE ASSISTANT NEVER LEAVES CENTRE-FRONT". THAT WAS HALF RIGHT. │
 * │                                                                          │
 * │ The half that holds: it must not be somewhere the user has to hunt for,   │
 * │ and it must not try to be in three places when three tasks run at once.   │
 * │ The half that was wrong: an assistant that has handed work out and is     │
 * │ waiting for it back is DOING something, and standing at the door it will  │
 * │ be handed through says so.                                               │
 * │                                                                          │
 * │ ⚠ TO THE LEFT OF THE FILING DESK, WITH A GAP — not against it. Against    │
 * │ it, the figure and the desk read as one object; the gap is what makes it  │
 * │ *waiting by the desk* rather than *filed at the desk*.                    │
 * │                                                                          │
 * │ ⚠ IT SITS BETWEEN TWO HOME SPOTS (ownSpot 2 and 3 of the back row) AND    │
 * │ THE BOXES OVERLAP by about 25 units. Accepted knowingly, and it is        │
 * │ survivable for exactly one reason: the assistant is drawn ABOVE every     │
 * │ worker (§17d), so the overlap can only ever hide part of a worker behind  │
 * │ the one figure the user is most likely to be looking at. Moving the back  │
 * │ row instead would re-lay the floor for a spot used a few seconds at a     │
 * │ time.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const ASSISTANT_WAIT: Point = { x: 664, y: 566 };

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
/** The keys in `web/src/office/art/furniture.ts`. Checked by `tsc` at the call site. */
export type FloorPieceId =
  | 'counter'
  | 'desk-files'
  | 'desk-laptop'
  | 'foosball'
  | 'sofa'
  | 'stool'
  | 'table-chess'
  | 'table-low';

export interface BreakPiece {
  id: FloorPieceId;
  /** Centre of the footprint. */
  x: number;
  /** Where the footprint meets the floor — same convention as a person's feet. */
  baseY: number;
  /**
   * 🔴 SORTED AGAINST THE PEOPLE BY `baseY`. → SPEC-office-animation.md §17b
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ THIS FLAG USED TO BE `front`, AND THE RENAME IS THE WHOLE CHANGE.       │
   * │                                                                           │
   * │ `front` meant *beats every person, whatever their y* — a layer that       │
   * │ sorted by nothing. The comment here said, in as many words, that it must  │
   * │ never become a general depth system, because "two layers that do not      │
   * │ share a coordinate system" could not be sorted.                           │
   * │                                                                           │
   * │ They share one now: a `sorted` piece is drawn in the SAME HTML stage as   │
   * │ the people, at the same world coordinates, and everything in that stage   │
   * │ — furniture and bodies alike — carries `z-index = round(baseY)`. One      │
   * │ integer, one stacking context, no layer to be on the wrong side of.       │
   * │                                                                           │
   * │ 🔴 WHAT THE FLAG NOW COSTS AND WHAT IT BUYS: a sorted piece is a DOM      │
   * │ node per frame nobody moves, so it is not free and it is not for          │
   * │ everything. Give it only to a piece somebody can legitimately stand       │
   * │ BEHIND — the two desks and the chess set. The plant, the cooler and the   │
   * │ bookshelf are objects §17f forbids standing behind, so sorting them       │
   * │ answers a question that cannot be asked.                                  │
   * │                                                                           │
   * │ ⚠ THE SHADOW DOES NOT COME WITH IT. A shadow is ON THE FLOOR and belongs  │
   * │ under everybody's shoes; only the ART moves into the sorted layer.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  sorted?: boolean;
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
  { id: 'table-chess', ...CHESS, sorted: true },
  { id: 'stool', ...CHESS_NEAR, sorted: true },
  { id: 'foosball', ...FOOSBALL },
];

/**
 * 🔴 THE TWO DESKS — the only station furniture people stand on BOTH sides of.
 * → SPEC-office-animation.md §17b · §17f③
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THEY ARE HERE, NOT IN `Room.tsx`, FOR THE REASON `BREAK_PIECES` EXISTS.  │
 * │                                                                          │
 * │ Their coordinates were literals at the call site — `x + w / 2`, `y + h`   │
 * │ typed into the JSX. That is one copy of a layout, and the room has        │
 * │ already paid for a second copy once: the break-area pieces and their      │
 * │ seats were written independently and drifted by up to 130 units the first │
 * │ time the area moved, silently, within one change.                        │
 * │                                                                          │
 * │ Now the standing places BEHIND the filing desk (§17f) are derived from    │
 * │ the same row the picture is drawn from, so a desk that moves takes its    │
 * │ people with it.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const deskOf = (id: FloorPieceId, s: Station): BreakPiece => ({
  id,
  x: s.x + s.w / 2,
  baseY: s.y + s.h,
  sorted: true,
});

export const DESK_PIECES: readonly BreakPiece[] = [
  deskOf('desk-files', STATIONS.artifacts),
  deskOf('desk-laptop', STATIONS.arm),
];

/**
 * Every floor piece that is drawn in the ACTOR layer and sorted by `baseY`.
 * The renderer reads exactly this; nothing else decides what is sorted.
 */
export const SORTED_PIECES: readonly BreakPiece[] = [
  ...DESK_PIECES,
  ...BREAK_PIECES.filter((p) => p.sorted),
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
 * │ 🔴 ⛔ ARRAY ORDER MEANS NOTHING ANY MORE, and the line that said it did  │
 * │ is deleted rather than softened. It read: *"ORDER IS FILL ORDER. Sofa    │
 * │ first because one person resting should look like resting; foosball      │
 * │ LAST because a single figure at a foosball table is a person with no     │
 * │ opponent."* `dealSeats` now shuffles the free seats (§17c′, the user's   │
 * │ call), so the fill order is gone and a comment describing it would be a  │
 * │ description of behaviour that no longer exists — the cheapest lie this   │
 * │ file could tell. The lone foosball player is a real, accepted cost.      │
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
 * 🔴 WHO SITS WHERE IN THE BREAK AREA — DEALT ONCE, NOT RE-DERIVED.
 * → docs/SPEC-office-animation.md §17c
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THIS REPLACES, AND WHY THE OLD WAY WAS VISIBLE.                     │
 * │                                                                          │
 * │ `direct()` used to seat the resting in `agents` order and take the first │
 * │ six. Two consequences, both of which the user saw:                       │
 * │                                                                          │
 * │  · the moment one person STOPPED resting, everybody behind them shifted  │
 * │    up a seat AND WALKED TO IT. Six people sliding across a corner        │
 * │    because one of them got a task — movement is this room's only word    │
 * │    for work, and that spent it on bookkeeping.                           │
 * │  · which six were drawn was decided by `id.localeCompare`, so it was     │
 * │    always the same six, for the life of the office.                      │
 * │                                                                          │
 * │ ⚠ A SEAT, ONCE DEALT, IS THAT PERSON'S FOR THE LIFE OF THE MOUNT — even  │
 * │ while they are away working. That is the whole point: they leave, the    │
 * │ seat stays empty, and they come back to it. Handing the empty seat to    │
 * │ the next person is exactly the shuffle above, arriving one step later.   │
 * │                                                                          │
 * │ ⚠ `rnd` IS INJECTED. A hash of the roster would look random and be       │
 * │ constant forever — the same six people every reload, which is the thing  │
 * │ this replaces wearing a different coat. Passing the source in is also    │
 * │ what makes it testable at all.                                          │
 * │                                                                          │
 * │ ⚠ IT ACCUMULATES rather than re-deals, so somebody hired MID-SESSION     │
 * │ still gets a free seat if one is left. Re-dealing on every roster change │
 * │ would move people who were already sitting down.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * @param roster  everybody who exists now — entries for anyone else are dropped,
 *                or a long session accumulates seats for deleted employees.
 * @param resting who is resting right now and therefore wants a seat.
 * @param prior   the deal so far. Empty on the first call after a mount.
 */
export function dealSeats(
  roster: readonly string[],
  resting: readonly string[],
  prior: Readonly<Record<string, number>>,
  rnd: () => number,
): Record<string, number> {
  const alive = new Set(roster);
  const out: Record<string, number> = {};
  const taken = new Set<number>();
  for (const id of roster) {
    const seat = prior[id];
    // ⚠ `taken` guards against a corrupt `prior` putting two people on one
    // cushion. It cannot happen through this function, and a seat map is exactly
    // the kind of value that gets hand-edited during a debugging session.
    if (seat === undefined || !Number.isInteger(seat) || seat < 0 || seat >= BREAK_CAPACITY) continue;
    if (taken.has(seat)) continue;
    out[id] = seat;
    taken.add(seat);
  }

  /**
   * 🔴 TWO INDEPENDENT SHUFFLES, BECAUSE THERE ARE TWO QUESTIONS. → §17c′
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ THE SECOND ONE IS NEW, AND THE COMMENT HERE USED TO ARGUE AGAINST IT.   │
   * │                                                                           │
   * │ It said: *"shuffling `free` instead would only randomise which cushion    │
   * │ each of the same six got"* — true, and it read as a reason not to, which  │
   * │ was wrong, because **which cushion** is exactly the half the user could   │
   * │ see. Only the QUEUE was shuffled and `free` was handed out in ascending   │
   * │ order, so with four people resting the answer was always seats 0,1,2,3:   │
   * │ both sofa cushions, the chess stool, the counter — **every single time,   │
   * │ every reload**. The foosball table only ever had anybody at it at exactly │
   * │ six. The room looked randomised and its layout was a constant.            │
   * │                                                                           │
   * │ The user's words, and they are two steps on purpose: *"first pick at      │
   * │ most six at random out of the pool of resting people; then randomise      │
   * │ each one's position, depending on nothing."*                              │
   * │                                                                           │
   * │   the QUEUE  answers WHO gets a seat when more than six are resting       │
   * │   the SEATS  answers WHERE each of them sits                              │
   * │                                                                           │
   * │ Shuffling one and ordering the other collapses the second question into   │
   * │ the first — the six chosen people are random, and then they always sit    │
   * │ in the same places in that order.                                         │
   * │                                                                           │
   * │ ⚠ ONLY THE FREE SEATS ARE SHUFFLED. Anything in `prior` keeps its         │
   * │ cushion: a seat once dealt is that person's for the life of the mount,    │
   * │ even while they are away working (see the box above). Re-dealing those    │
   * │ too is the shuffle-on-every-event this function exists to prevent.        │
   * │                                                                           │
   * │ 🔴 THE COST, AND IT IS A RULE THIS REPLACES: §17c used to say *"ORDER IS  │
   * │ FILL ORDER — sofa first because one person resting should look like       │
   * │ resting; foosball LAST because a single figure at a foosball table is a   │
   * │ person with no opponent."* Independent placement gives that up: one       │
   * │ resting employee can now turn up alone at one end of the foosball table.  │
   * │ Stated rather than quietly lost — the user asked for *"depending on       │
   * │ nothing"* with the old rule in front of them, and restoring a bias is     │
   * │ one weighted pick away if the lone player ever reads badly.               │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const shuffle = <T>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    }
    return xs;
  };

  const wants = shuffle(resting.filter((id) => alive.has(id) && out[id] === undefined));
  const free: number[] = [];
  for (let s = 0; s < BREAK_CAPACITY; s++) if (!taken.has(s)) free.push(s);
  shuffle(free);

  for (const id of wants) {
    const seat = free.shift();
    // Past the capacity: no seat, and `direct()` reads that as `offscreen`.
    if (seat === undefined) break;
    out[id] = seat;
  }
  return out;
}

/**
 * ⚠ Sized against `CH_H`, not chosen by eye. A column narrower than a person is
 * wide, or a row shorter than a person is tall, and the arc turns into a pile.
 *
 * ⚠ THEY LIVE ABOVE `HOME_SPOTS`, NOT BESIDE `ownSpot`, AND THE ORDER IS LOAD-
 * BEARING. `HOME_SPOTS` calls `ownSpot` at MODULE LOAD; the function declaration
 * hoists but a `const` does not, so leaving these three below it is a temporal
 * dead zone that throws before the app draws anything.
 */
const PER_ROW = 5;
const COL = 237;
const ROW = 202;

// ──────────────────────────────────────────────── where an idle person may stand

/**
 * 🔴 HALF THE WIDEST FIGURE, AND THE FIGURE'S HEIGHT, IN WORLD UNITS.
 * → docs/SPEC-office-animation.md §17f①
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY RULE ABOUT WHERE SOMEBODY MAY STAND IS WRITTEN ABOUT THEIR FEET,   │
 * │ AND EVERY RULE THAT MATTERS IS ABOUT THEIR BOX.                          │
 * │                                                                          │
 * │ That gap is how a figure ends up half inside the wall while its          │
 * │ coordinate is perfectly legal. Stating the box once, here, is what lets  │
 * │ the safe area below be checked rather than eyeballed.                    │
 * │                                                                          │
 * │ Derived, not guessed: a cell is `CELL.w / CELL.h` of `CH_H × CELL.h /    │
 * │ BODY_H`, the drawn figure fills ~87% of the cell's width, and the        │
 * │ largest per-sheet `scale` is 1.1. 177 × (720/690) × (480/720) × 0.87 ×   │
 * │ 1.1 ≈ 118 wide, ≈ 195 tall.                                              │
 * │                                                                          │
 * │ ⚠ THE STRIP GEOMETRY LIVES IN `web/.../art/manifest.ts` AND CANNOT BE    │
 * │ IMPORTED HERE — `core` is pure and the manifest imports PNGs. So these    │
 * │ two are a measurement written down, not a computation, and                │
 * │ `test/office-view.test.ts` is where the two are held against each other.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const BODY_HALF_W = 62;
export const BODY_TALL = 196;

/**
 * 🔴 HOW FAR BELOW THE FEET A PERSON REACHES — because a person is not only a
 * body. → `office.css §.actor-name` · §17f①
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE NAME IS PART OF THE FIGURE, AND THE BOTTOM EDGE FORGOT IT.           │
 * │                                                                          │
 * │ `SAFE.y1` was `WORLD.h − 22`, derived from the drawing alone: feet 22    │
 * │ units off the bottom, nothing cut. But every actor also carries a label  │
 * │ hung BELOW the anchor — `.actor-name` sits at `top: 6px` with a ~17-unit │
 * │ line box — so the front row's names ran off the floor while every        │
 * │ measurement said the room was legal. Same failure as §17f① one layer     │
 * │ out: the rule was written about the part of the figure somebody was      │
 * │ thinking of, not about the whole of it.                                  │
 * │                                                                          │
 * │ ⚠ 24, not 23: the label's own descenders. It is a stated measurement of  │
 * │ the stylesheet, which is why it is named here rather than folded into    │
 * │ the `y1` expression — `test/office-view.test.ts` holds the two together. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const NAME_DROP = 24;

/**
 * 🔴 THE SAFE AREA — a law about BOUNDING BOXES. → §17f①
 *
 * Feet may land anywhere in this rectangle and nowhere else. Each edge answers
 * one of the user's rules, and none of them is a margin chosen to look right:
 *
 * | top    | feet above the wall/floor junction is a person climbing the wall |
 * | bottom | the front row must not be cut off by the frame — NAME INCLUDED   |
 * | left   | ⚠ the box, not the feet — at `x = 62` the figure's left edge is 0 |
 * | right  | never in the break area, and never to the right of it            |
 */
export const SAFE = {
  x0: BODY_HALF_W + 8,
  y0: HORIZON + 24,
  x1: BREAK_AREA.x - BODY_HALF_W,
  y1: WORLD.h - 22 - NAME_DROP,
};

export const clampSafe = (p: Point): Point => ({
  x: Math.min(SAFE.x1, Math.max(SAFE.x0, p.x)),
  y: Math.min(SAFE.y1, Math.max(SAFE.y0, p.y)),
});

/** Is this coordinate on the break-area rug? Used to keep the working floor separate. */
export const inBreakArea = (p: Point): boolean =>
  p.x >= BREAK_AREA.x && p.x <= BREAK_AREA.x + BREAK_AREA.w &&
  p.y >= BREAK_AREA.y && p.y <= BREAK_AREA.y + BREAK_AREA.h;

/**
 * 🔴 THE TEN DEFAULT SPOTS, AS PLACES RATHER THAN AS PEOPLE'S HOMES.
 *
 * ⚠ SAME GENERATOR, DIFFERENT QUESTION, AND THE DIFFERENCE IS THE SEED.
 * `ownSpot(i, total, agentId)` answers *"where does THIS PERSON live"* and moves
 * when the headcount changes. This answers *"what are the ten places on the
 * floor"*, so it is pinned at `total = 10` and seeded by the index — otherwise
 * the map of the room would change shape every time somebody was hired.
 *
 * ⚠ THE ELEVENTH IS NOT HERE. At `PER_ROW = 5` index 10 starts a third row at
 * `y = 950` in a 900-unit world — off the floor, and the user saw it.
 */
export const HOME_SPOTS: readonly Point[] = Array.from({ length: 10 }, (_, i) =>
  clampSafe(ownSpot(i, 10, `slot:${i}`)),
);

/**
 * 🔴 EVERY FIXED PLACE AN IDLE WORKER MAY STAND. → §17f④
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DERIVED FROM THE FURNITURE, NEVER TYPED AS A PAIR OF NUMBERS.            │
 * │                                                                          │
 * │ This is the third table in this file that could have been literals, and  │
 * │ the first two both drifted: the break-area pieces against their seats,   │
 * │ and the desks against their stations. A spot in front of the cooler that │
 * │ does not follow the cooler is a person standing in the middle of the     │
 * │ floor pointing at nothing.                                               │
 * │                                                                          │
 * │ ⚠ `IN_FRONT` is 34 units below the object's base — the same gap          │
 * │ `ringSlots` uses, so a person waiting at an object and a person WORKING  │
 * │ at one stand at the same distance from it. Two distances would read as   │
 * │ two different rooms.                                                     │
 * │                                                                          │
 * │ ⚠ THE MAP IS ALLOWED TO BE CROWDED. Two spots closer than a body width   │
 * │ do not have to be pulled apart here — `pickIdleSpot` refuses a spot too  │
 * │ near somebody who is standing on, or walking to, its neighbour. Spacing  │
 * │ is enforced once, at the moment of choosing, instead of by hand in       │
 * │ twenty-six coordinates.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const IN_FRONT = 34;

/**
 * 🔴 HOW FAR BEHIND A DESK SOMEBODY STANDS TO WORK AT IT. → §17b · `usedFrom`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE NUMBER, TWO CALLERS, AND IT WAS A LITERAL IN ONE OF THEM.            │
 * │                                                                          │
 * │ The three idle places behind the filing desk were `FILING.baseY - 48`,   │
 * │ typed here; the arm bench now needs the same relationship for the person │
 * │ actually typing at it. Two `- 48`s in two files is the pair that drifts, │
 * │ and this one drifts INVISIBLY: nothing is out of place, somebody just    │
 * │ stands a little more in front of one desk than the other.                │
 * │                                                                          │
 * │ ⚠ IT IS AN OCCLUSION NUMBER, NOT A GAP. Standing behind a desk only      │
 * │ reads as *at* it because the desk is a sorted piece drawn over the legs  │
 * │ (`z-index = round(baseY)`, and the person's is `round(y)`). Measured:    │
 * │ 48 hides 57 units of shin at the filing desk (art 105 tall) and 68 at    │
 * │ the arm bench (116 tall) — both well short of the knee, which is what    │
 * │ keeps it reading as a person and not as a bust on a shelf.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const BEHIND_DESK = 48;

/**
 * 🔴 HOW MUCH OF AN OBJECT MUST STILL BE SEEN PAST THE PERSON AT IT. → §17f④
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SQUARELY IN FRONT ERASES THE OBJECT, AND BOTH OF THE USER'S REPORTS WERE │
 * │ THE SAME SENTENCE ABOUT TWO DIFFERENT PIECES.                            │
 * │                                                                          │
 * │   the plant   74 units wide, standing under a body 124 wide              │
 * │   the cooler  39 units wide — a body covers it three times over          │
 * │                                                                          │
 * │ The rule already existed in the break area and was written down there:   │
 * │ *"a person is taller than the counter and wider than half of it, so      │
 * │ dead-centre erases the whole object"* (→ `BREAK_SEATS`). It had simply   │
 * │ never been carried across to the two objects on the working floor.       │
 * │                                                                          │
 * │ 🔴 IT IS THE VISIBLE SLIVER, NOT THE OFFSET — and the first cut of this   │
 * │ change got that wrong. *"Stand 24 units past the object's edge"* sounds   │
 * │ object-relative and is not: the sliver it leaves is                       │
 * │ `2 × halfW + offset − BODY_HALF_W`, so the same 24 leaves 36 units of the │
 * │ plant showing and **2 units** of the cooler. The narrower the object, the │
 * │ less the rule gives it — exactly backwards, and the test caught it.       │
 * │                                                                          │
 * │ ⇒ State the OUTCOME and solve for the offset. `dx` below comes out at 47  │
 * │ for the plant and 64 for the cooler, and neither is a number anybody has  │
 * │ to keep in step with the artwork.                                        │
 * │                                                                          │
 * │ ⚠ THE DIRECTION IS PER-OBJECT, not part of the constant. The plant is     │
 * │ pushed RIGHT because there is nothing but wall to its left; the cooler is │
 * │ pushed LEFT because the break area starts 70 units to its right.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const VISIBLE = 22;

/** Centre-to-centre offset that leaves `VISIBLE` units of a `halfW`-wide piece showing. */
const beside = (halfW: number): number => BODY_HALF_W + VISIBLE - halfW;

/**
 * Base lines the map hangs off, so nothing here is an unexplained number.
 *
 * ⚠ EXPORTED, AND `Room.tsx` NOW DRAWS FROM THEM. They were literals in the JSX
 * as well — a second copy of one layout, which is the pair that drifted by up to
 * 130 units the first time the break area moved (→ `BREAK_PIECES`). A plant that
 * moves without taking the person standing beside it is exactly that bug again.
 *
 * ⚠ `halfW` is a measurement of the artwork (`art/furniture.ts`: `h × ar / 2`),
 * not a choice. `core` cannot import the manifest — it is pure and the manifest
 * imports PNGs — so `test/office-view.test.ts` is where the two are held
 * against each other, the same arrangement `BODY_HALF_W` already has.
 */
export const PLANT = { x: 64, baseY: HORIZON + 74, halfW: 37 };
export const COOLER = { x: 1100, baseY: HORIZON + 34, halfW: 20 };
const SHELF_BASE = STATIONS.library.y + STATIONS.library.h;
const FILING = DESK_PIECES[0]!;

export const IDLE_SPOTS: readonly Point[] = [
  // the plant — in front but OFF TO ITS RIGHT (→ `VISIBLE`), and further right
  // again. Never to its LEFT: past it there is a body-width of floor and then
  // the wall.
  { x: PLANT.x + beside(PLANT.halfW), y: PLANT.baseY + IN_FRONT },
  { x: PLANT.x + PLANT.halfW + BODY_HALF_W + 9, y: PLANT.baseY + 18 },
  // the document cabinet — three, in front
  { x: 196, y: SHELF_BASE + 58 },
  { x: 292, y: SHELF_BASE + 58 },
  { x: 388, y: SHELF_BASE + 58 },
  // under the picture, the two window panes and the planning board. Wall objects,
  // so the only constraint is the wall itself: feet below `SAFE.y0`.
  { x: 452, y: HORIZON + 40 },
  { x: 640, y: HORIZON + 40 },
  { x: 760, y: HORIZON + 40 },
  { x: 950, y: HORIZON + 40 },
  // the water cooler — in front but OFF TO ITS LEFT, so the bottle is still
  // visible past the shoulder of whoever is standing at it. → `VISIBLE`
  { x: COOLER.x - beside(COOLER.halfW), y: COOLER.baseY + IN_FRONT },
  /**
   * 🔴 THE FILING DESK — EIGHT, AND THREE OF THEM ARE BEHIND IT.
   *
   * The only object in the room with places on both sides, which is the whole
   * reason §17b exists: "behind" here means `y < the desk's baseY`, and the
   * `z-index` sort then draws the desk over them. Nothing else is needed —
   * there is no second rule saying which is in front.
   */
  { x: FILING.x - 106, y: FILING.baseY + 40 },
  { x: FILING.x, y: FILING.baseY + 40 },
  { x: FILING.x + 106, y: FILING.baseY + 40 },
  { x: FILING.x - 106, y: FILING.baseY - BEHIND_DESK },
  { x: FILING.x, y: FILING.baseY - BEHIND_DESK },
  { x: FILING.x + 106, y: FILING.baseY - BEHIND_DESK },
  { x: FILING.x - 190, y: FILING.baseY },
  { x: FILING.x + 190, y: FILING.baseY },
  ...HOME_SPOTS,
].map(clampSafe);

/**
 * How near two people may be before they read as one clump.
 *
 * ⚠ IT IS SMALLER THAN `PAIR_GAP`, ON PURPOSE. A spot is refused when somebody
 * is within `CLEAR` of it — and the "stand beside a colleague" spot is offered at
 * `PAIR_GAP`, just outside that, which is what lets a pair form at all while
 * every other kind of crowding is refused.
 */
const CLEAR = 90;
const PAIR_GAP = 112;

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** What the picker needs to know about everybody else. Positions, not nodes. */
export interface IdleWorld {
  /** id → where they are standing right now. */
  at: Readonly<Record<string, Point>>;
  /** id → where they are heading. A spot somebody is walking to is taken. */
  to: Readonly<Record<string, Point>>;
  /** Who is standing still on the working floor — the only people worth joining. */
  standing: readonly string[];
}

/**
 * 🔴 WHERE AN IDLE WORKER GOES NEXT. → §17f⑤
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ UNIFORMLY AT RANDOM AMONG WHAT IS FREE — NOT NEAREST, NOT WEIGHTED.      │
 * │                                                                          │
 * │ Nearest turns the map into a rut: the same two spots, forever, because   │
 * │ the nearest free spot to where you already are is the one next to you.   │
 * │ A weighting is a preference nobody asked for and nobody can read off the │
 * │ screen.                                                                  │
 * │                                                                          │
 * │ ⚠ NEVER A GROUP OF THREE. A "beside a colleague" spot is offered only    │
 * │ next to somebody who is ALONE. The check is the same `CLEAR` radius the  │
 * │ rest of the picker uses, so "already has company" and "too crowded to    │
 * │ stand here" are one definition rather than two that can disagree.        │
 * │                                                                          │
 * │ ⚠ THE ASSISTANT'S TWO PLACES ARE NOT IN `IDLE_SPOTS` AND MUST NOT BE.    │
 * │ Nobody goes looking for the assistant. Its positions still appear in     │
 * │ `world.at`, so they are avoided as OBSTACLES — which is the honest       │
 * │ shape: a body to steer around, not a destination.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * @returns a target, or `null` when everywhere is taken — which means STAY PUT.
 *          A fallback that returned "somewhere, anywhere" would walk somebody
 *          into a colleague to avoid returning nothing.
 */
export function pickIdleSpot(id: string, world: IdleWorld, rnd: () => number): Point | null {
  const others = Object.entries(world.at).filter(([k]) => k !== id);
  const heading = Object.entries(world.to).filter(([k]) => k !== id);

  const here = world.at[id];
  const free = (p: Point, ignore?: string): boolean => {
    if (p.x < SAFE.x0 || p.x > SAFE.x1 || p.y < SAFE.y0 || p.y > SAFE.y1) return false;
    // ⚠ The spot you are ALREADY ON is not an option. It is legal — nobody is in
    // the way, because it is you — and picking it spends a whole idle window on
    // a walk of zero units, which reads as the room having stalled.
    if (here && dist(p, here) < 1) return false;
    for (const [k, q] of others) if (k !== ignore && dist(p, q) < CLEAR) return false;
    for (const [k, q] of heading) if (k !== ignore && dist(p, q) < CLEAR) return false;
    return true;
  };

  const options: Point[] = IDLE_SPOTS.filter((p) => free(p));

  for (const mate of world.standing) {
    if (mate === id) continue;
    const here = world.at[mate];
    if (!here || inBreakArea(here)) continue;
    // Already half of a pair ⇒ joining makes three.
    if (others.some(([k, q]) => k !== mate && dist(here, q) < PAIR_GAP + CLEAR)) continue;
    for (const side of [-1, 1]) {
      const p = { x: here.x + side * PAIR_GAP, y: here.y };
      if (free(p, mate)) options.push(p);
    }
  }

  if (options.length > 0) return options[Math.floor(rnd() * options.length) % options.length] ?? null;

  /**
   * ⚠ THE FALLBACK IS BOUNDED AND MAY GIVE UP. Twelve tries at a random point in
   * the safe area, then `null`. An unbounded search on a crowded floor is a loop
   * that runs until it gets lucky, inside a function called from a timer.
   */
  for (let i = 0; i < 12; i++) {
    const p = {
      x: SAFE.x0 + rnd() * (SAFE.x1 - SAFE.x0),
      y: SAFE.y0 + rnd() * (SAFE.y1 - SAFE.y0),
    };
    if (free(p)) return p;
  }
  return null;
}

/**
 * 🔴 WHERE EVERYBODY IS STANDING THE MOMENT THE ROOM OPENS. → §17l
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE VIEW SWITCH WAS DEALING THE SAME HAND EVERY TIME.                    │
 * │                                                                          │
 * │ `Office` mounts a fresh `Stage` on every toggle, and `Stage.sync` puts    │
 * │ somebody at their HOME the first time it sees them — which is            │
 * │ `ownSpot()`, a five-wide arc. So every trip to the diagram and back       │
 * │ re-formed the same parade line, and it was the user's report: *"I do not  │
 * │ want every toggle to go back to the default line-up."*                    │
 * │                                                                          │
 * │ ⚠ THIS IS THE CHEAP HALF OF THE TWO ANSWERS THEY OFFERED, AND IT IS THE  │
 * │ ONE THAT ALSO SATISFIES THE OTHER HALF. Carrying live positions across    │
 * │ the toggle would preserve continuity nobody can see — the room was not on │
 * │ screen — and it would freeze the same people in the same places for the   │
 * │ life of the tab, which is the *"avoid sitting and standing put"* the same │
 * │ message asks against. Re-dealing gives both: no line-up, and a room that  │
 * │ is composed differently each time it is looked at.                       │
 * │                                                                          │
 * │ ⚠ IT DEALS AGAINST ITSELF AS IT GOES. Each pick is made in a world that   │
 * │ already contains everybody dealt before it, so the `CLEAR` radius applies │
 * │ between the new arrivals — otherwise every person would be placed against │
 * │ an empty floor and the whole room could land on one spot.                │
 * │                                                                          │
 * │ ⚠ A MISS IS `undefined`, NOT A GUESS. `pickIdleSpot` returns `null` when  │
 * │ everywhere is taken, and the caller's fallback is the person's OWN SPOT — │
 * │ the arc it was replacing. A crowded office degrades to the old picture    │
 * │ rather than to bodies inside each other.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * @param ids people who are free to stand anywhere — everybody with `roam`.
 */
export function dealOpeningSpots(
  ids: readonly string[],
  rnd: () => number,
): Record<string, Point> {
  const out: Record<string, Point> = {};
  for (const id of ids) {
    // ⚠ `standing` is empty on purpose: the "stand beside a colleague" offer is
    // about somebody who has been on the floor long enough to be joined. At the
    // instant the view opens nobody has been anywhere, and offering it here
    // would pair people up before the room has drawn a single frame.
    const p = pickIdleSpot(id, { at: out, to: out, standing: [] }, rnd);
    if (p) out[id] = p;
  }
  return out;
}

/**
 * 🔴 HOW MANY IDLE WORKERS ARE ALREADY WALKING WHEN THE ROOM OPENS. → §17l
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ *"Everybody standing still at that moment is a bit stiff."*              │
 * │                                                                          │
 * │ The user's number, and the `ceil` is theirs too — it is what makes ONE   │
 * │ idle worker still produce one walker instead of rounding the office down │
 * │ to a photograph. An empty floor produces none: there is nobody to move,  │
 * │ and inventing motion is the thing §17g exists to forbid.                 │
 * │                                                                          │
 * │ ⚠ IT APPLIES ON EVERY OPEN, INCLUDING A RELOAD. The positions differ     │
 * │ between the two cases (a reload starts from the arc, a toggle from a     │
 * │ fresh deal); the *liveliness* does not, because the reason for it —      │
 * │ "show the office is working" — does not care how the page got here.      │
 * │                                                                          │
 * │ ⚠ IT IS A COUNT, NOT A PROBABILITY. A one-in-five die rolled per person  │
 * │ gives an office that is occasionally completely still, which is the one  │
 * │ outcome this exists to prevent.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const walkersAtOpen = (idle: number): number => (idle > 0 ? Math.ceil(idle / 5) : 0);

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
 * 🔴 THE ONE PLACE THIS OBJECT IS USED FROM — or `null` if it has none.
 * → `Station.use` · docs/SPEC-office-animation.md §17f′
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT ADDS A PREFERENCE, AND — for `front` — NOT ONE NEW COORDINATE.        │
 * │                                                                          │
 * │ `front` IS the ring's first slot, which has always been the dead-centre  │
 * │ one. Nothing about the floor plan moves; what changes is that it is      │
 * │ ASKED FOR first instead of being one of six candidates a distance test   │
 * │ almost never picked.                                                     │
 * │                                                                          │
 * │ ⚠ `behind` IS a new point, and it is centred on the desk rather than on  │
 * │ the laptop drawn on it. Measured 08/09 in `desk-laptop.png`: the laptop  │
 * │ centres at 0.4878 of the image width, i.e. **2 world units** left of the │
 * │ desk's own centre — a body is 124 wide. A `laptopOffset` would be a      │
 * │ measurement of an image that somebody has to keep in step with the art   │
 * │ for two units nobody can see. → `art/furniture.ts`                       │
 * │                                                                          │
 * │ ⚠ NO FURNITURE MOVED FOR ANY OF THIS. The user's own constraint, and it  │
 * │ is also `Room.tsx`'s standing rule: the art follows the coordinates,     │
 * │ never the other way round.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function usedFrom(s: Station): Point | null {
  if (!s.use) return null;
  if (s.use === 'front') return ringSlots(s)[0]!;
  return { x: s.x + s.w / 2, y: s.y + s.h - BEHIND_DESK };
}

/**
 * 🔴 WHERE THE SEVENTH PERSON AT ONE STATION STANDS. → §17f″
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE COMMENT PROMISED THIS AND THE CODE DID THE OPPOSITE.                 │
 * │                                                                          │
 * │ `nearestFreeSlot` read: *"every slot taken ⇒ stop at the ring's EDGE     │
 * │ rather than stack two people on one spot"* — and returned **one point**, │
 * │ the same one, to everybody. Measured with nine workers all reading       │
 * │ documents: six took the ring, and the last **three stood on (283, 500)**,│
 * │ one body inside another. A sentence is not a mechanism.                  │
 * │                                                                          │
 * │ ⚠ SPACED BY A WHOLE BODY, not by a gap that looks about right:           │
 * │ `BODY_HALF_W × 2` is the width of the figure, so two neighbours here     │
 * │ touch and never overlap. The +6 keeps a hair of floor between them.      │
 * │                                                                          │
 * │ ⚠ CENTRE OUTWARDS, and points outside the safe area are DROPPED rather   │
 * │ than clamped: clamping two of them lands both on the same edge x, which  │
 * │ is the stacking this exists to end, wearing a different coordinate.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function overflowSlots(s: Station): Point[] {
  const cx = s.x + s.w / 2;
  const y = s.y + s.h + 96;
  if (y < SAFE.y0 || y > SAFE.y1) return [];
  const out: Point[] = [];
  for (let i = 0; i < 7; i++) {
    // 0, −1, +1, −2, +2, … so the row grows outwards from the middle.
    const step = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 === 1 ? -1 : 1);
    const x = cx + step * (BODY_HALF_W * 2 + 6);
    if (x >= SAFE.x0 && x <= SAFE.x1) out.push({ x, y });
  }
  return out;
}

/**
 * Picks the free slot NEAREST to where the walker is standing right now.
 *
 * Nearest, not first: it makes the approach direction depend on where somebody
 * came from, so the same trip never looks identically choreographed twice — and
 * it costs one comparison. Every slot taken ⇒ a place on the ring's edge, one
 * body apart from the last one. → `overflowSlots`
 */
export function nearestFreeSlot(s: Station, from: Point, taken: readonly Point[]): Point {
  const isTaken = (p: Point): boolean =>
    taken.some((q) => Math.abs(q.x - p.x) < 1 && Math.abs(q.y - p.y) < 1);

  let best: Point | undefined;
  let bestD = Infinity;
  for (const slot of ringSlots(s)) {
    if (isTaken(slot)) continue;
    const d = (slot.x - from.x) ** 2 + (slot.y - from.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = slot;
    }
  }
  if (best) return best;

  const edge = overflowSlots(s);
  for (const p of edge) if (!isTaken(p)) return p;
  /**
   * ⚠ THE LAST RESORT STILL STACKS, and it is stated rather than hidden: past
   * 6 ring slots + the edge row, the room has genuinely run out of floor at
   * this object. Reachable only with ~12 workers at ONE station in ONE office,
   * which the scheduler does not produce today.
   */
  return edge[edge.length - 1] ?? { x: s.x + s.w / 2, y: s.y + s.h + 96 };
}

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
   * agent id → index into `BREAK_SEATS`. → `dealSeats`
   *
   * ⚠ THIS FUNCTION NO LONGER DECIDES WHO SITS WHERE, and the split is the
   * point: seating is a decision taken ONCE PER MOUNT with a random source,
   * while `direct()` runs on every SSE event and must give the same answer every
   * time it is asked. Putting a `Math.random()` in here would make the one pure,
   * tested rule in the room non-deterministic.
   *
   * An id with no entry is resting OFF SCREEN — see `BREAK_CAPACITY`.
   */
  seats: Readonly<Record<string, number>>;
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
  /**
   * 🔴 FREE TO WANDER. → docs/SPEC-office-animation.md §17f · §17g
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ `target` IS STILL SET, AND IT IS NOT THE WANDER TARGET.                 │
   * │                                                                           │
   * │ It is where this person belongs when nothing else is happening — their    │
   * │ own spot — and it is what places them the first time the scene sees them. │
   * │ WHERE they wander to is chosen by `pickIdleSpot`, WHEN is a timer in the  │
   * │ movement loop, and neither belongs in a pure function that re-runs on     │
   * │ every SSE event and must give the same answer every time.                 │
   * │                                                                           │
   * │ ⚠ THE FLAG IS THE HAND-OVER. `Stage` walks somebody only while it is set; │
   * │ the moment work arrives it goes false, and that is the whole of §17e —    │
   * │ *"when the assistant hands out a task the worker stops where it is"*.     │
   * │ No separate stop signal, because a second mechanism for stopping is a     │
   * │ second mechanism that can miss.                                           │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  roam?: true;
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
   * ⚠ THE PLACE IT IS USED FROM FIRST, THE RING AFTER — and "free" means the
   * same thing for both, because `taken` is the same list. A second person
   * reading documents still gets a nearest-free slot; they simply cannot have
   * the one the first person is standing in. → `usedFrom` · §17f′
   */
  const slot = (id: StationId, from: Point): Point => {
    const station = STATIONS[id];
    const first = usedFrom(station);
    const free =
      first && !taken.some((p) => Math.abs(p.x - first.x) < 1 && Math.abs(p.y - first.y) < 1);
    const p = free ? first : nearestFreeSlot(station, from, taken);
    taken.push(p);
    return p;
  };

  if (input.assistantId) {
    const from = input.at(input.assistantId) ?? ASSISTANT_SPOT;
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 THREE PLACES, AND THE THIRD ONE IS "WHEREVER IT ALREADY IS".      │
     * │ → docs/SPEC-office-animation.md §17d                                 │
     * │                                                                      │
     * │   reading documents   the bookshelf ring. The one trip that draws an │
     * │                       observed fact, so §6e keeps it.                │
     * │   waiting on a task   `ASSISTANT_WAIT`, beside the filing desk —     │
     * │                       standing at the door the work comes back in.   │
     * │   otherwise           ⚠ `from`. NOT `ASSISTANT_SPOT`.                │
     * │                                                                      │
     * │ ⚠ THE THIRD LINE IS THE USER'S RULE AND IT IS EASY TO "FIX" BACK:    │
     * │ *"the assistant does not need to go back to the default position     │
     * │ unless there is a toggle or an F5."* Walking home reports nothing —  │
     * │ it is the room spending its only vocabulary for work on tidying up.  │
     * │ Home is where the NEXT MOUNT puts it, because `at()` returns         │
     * │ undefined before anybody has been placed and this line then falls    │
     * │ through to `ASSISTANT_SPOT` on its own.                              │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const waiting = Object.values(input.live).some((l) => l.status === 'working');
    out.push({
      id: input.assistantId,
      target:
        input.reading === 'library' ? slot('library', from) : waiting ? ASSISTANT_WAIT : from,
      pose: 'stand',
    });
  }

  input.agents.forEach((agent, i) => {
    const state = input.live[agent.role];
    /**
     * 🔴 CLAMPED, AND THIS IS THE BUG THE USER REPORTED AS "the eleventh spot is
     * broken". → docs/SPEC-office-animation.md §17f
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ MEASURED IN THE LIVE ROOM, 07/09, on an office with eleven employees: │
     * │                                                                      │
     * │   `vvv`  y = 946   in a 900-unit world — standing under the floor    │
     * │   `d`    x = 50    left edge at −12 — half of them off the picture   │
     * │                                                                      │
     * │ At `PER_ROW = 5` the eleventh person opens a THIRD ROW at y = 950,    │
     * │ and the arc's left column starts at x = 46 while a body is 62 wide    │
     * │ from its centre. Both are `ownSpot` doing exactly what it says.       │
     * │                                                                      │
     * │ ⚠ THE FIRST FIX WAS PUT ON THE WRONG TABLE. `HOME_SPOTS` — the idle   │
     * │ MAP — was clamped and had a gate; `home` here, which is where people  │
     * │ actually stand, was not. A rule has to be applied to the thing it     │
     * │ governs, and a gate on the copy is a gate that watches the wrong      │
     * │ door: the tests were green while the room was wrong.                  │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const home = clampSafe(ownSpot(i, input.agents.length, agent.id));
    const from = input.at(agent.id) ?? home;

    // Resting = on the diagram but not wired, and not currently working. The
    // same source the diagram already prints the word "resting" from, so the
    // two views cannot disagree.
    if (!agent.connected && !state) {
      // ⚠ THE SEAT IS LOOKED UP, NOT COUNTED OUT. → `dealSeats` · §17c
      const seat = BREAK_SEATS[input.seats[agent.id] ?? -1];
      // No seat in the deal: still resting, still counted, simply not drawn. The
      // target is their own spot so that the day they stop resting they are
      // already where they belong rather than sliding in from a corner.
      if (!seat) {
        out.push({ id: agent.id, target: home, pose: 'stand', rest: 'offscreen' });
        return;
      }
      out.push({ id: agent.id, target: { x: seat.x, y: seat.y }, pose: seat.pose, rest: 'seated' });
      return;
    }

    /**
     * ⚠ "STAY WHERE YOU ARE" — unless where you are is the break area.
     *
     * A worker handed a task stops on the spot (§17e); walking them to their own
     * spot first would be a trip that reports nothing. The one exception is the
     * person who was RESTING when the work arrived: standing up and walking out
     * of the break area is the most legible thing this view draws, and it is
     * also the only way they leave a place the working floor forbids.
     */
    const stay = inBreakArea(from) ? home : from;

    if (state?.status === 'working') {
      const station = STATION_OF[state.at ?? 'desk'];
      out.push({
        id: agent.id,
        target: station ? slot(station, from) : stay,
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

    /**
     * Wired, nothing running: on the floor and free to wander. `state` is still
     * set for a few seconds after a task ends (`done` clears itself), which is
     * what keeps somebody from wandering off mid hand-off.
     */
    out.push({ id: agent.id, target: state ? stay : home, pose: 'stand', ...(state ? {} : { roam: true }) });
  });

  return out;
}

/** Who just stopped resting, and who is resting after this pass. → `releasedFromRest` */
export interface Released {
  /** Send these out of the break area NOW, in placement order. */
  go: string[];
  /** Everybody resting as of this pass. Hand it back on the next call. */
  resting: Set<string>;
}

/**
 * 🔴 WHO WAS JUST PUT BACK ON THE FLOOR — the moment a wire is plugged in.
 * → docs/SPEC-office-animation.md §17f · §9
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE TARGET `direct()` GIVES THEM IS NEVER APPLIED, AND THAT IS BY        │
 * │ DESIGN — WHICH IS WHY THIS EXISTS.                                       │
 * │                                                                          │
 * │ Reconnected, no task ⇒ `{ target: home, roam: true }`. The caller must   │
 * │ NOT `setTarget` anybody roaming (two owners of one destination, and the  │
 * │ idle timer wins a second later), so the only thing that ever moves them  │
 * │ is that timer — whose FIRST delay is seeded, `hash32 % 45 s`. Measured   │
 * │ in the live room: they stand up on the spot and leave the break area     │
 * │ somewhere between 0 and 45 seconds later. The user reported exactly      │
 * │ that, and *"not too bad"* is not the same as right: standing up inside   │
 * │ the break area says they are still resting.                              │
 * │                                                                          │
 * │ ⚠ A TRANSITION, NOT A POSITION TEST. *"Anybody roaming who is standing   │
 * │ on the rug"* would fire again on every SSE event for as long as they     │
 * │ were stuck there — and each firing re-arms the hold, so a crowded floor  │
 * │ (`pickIdleSpot` → `null`) would keep resetting the very timer that is    │
 * │ their way out. One release, one nudge, then the ordinary cadence.        │
 * │                                                                          │
 * │ ⚠ THE SET IS REBUILT, NOT EDITED. Somebody deleted while resting would   │
 * │ otherwise sit in it for the life of the tab, and come back from the dead │
 * │ the day their id was hired again — the ledger bug, in a `Set`.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ It says WHO, never WHERE. The destination stays `pickIdleSpot`'s, through
 * the same `Stage.nudge` the opening walk already uses — one code path for "an
 * idle worker walks somewhere", and one place that can put a body inside a wall.
 */
export function releasedFromRest(
  prev: ReadonlySet<string>,
  placements: readonly Placement[],
): Released {
  const go: string[] = [];
  const resting = new Set<string>();
  for (const p of placements) {
    if (p.rest) {
      resting.add(p.id);
      continue;
    }
    // ⚠ `roam` is the whole test on this side: somebody released STRAIGHT into a
    // task is already being walked by their placement, and nudging them would be
    // a second owner of that trip. → `Placement.roam`
    if (p.roam && prev.has(p.id)) go.push(p.id);
  }
  return { go, resting };
}
