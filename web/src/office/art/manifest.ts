import { FACE_COUNT, MAX_SIT_LIFT } from '@core/cast';
import { CH_H } from '@core/office-floor';

import cast0 from './cast/cast-0.png';
import cast1 from './cast/cast-1.png';
import cast2 from './cast/cast-2.png';
import cast3 from './cast/cast-3.png';
import cast4 from './cast/cast-4.png';

/**
 * THE ART MANIFEST — every picture in the office, and where it came from.
 * → docs/SPEC-office-art.md · SPEC-office-animation.md §2c
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ THERE IS NO LONGER A FALLBACK DRAWING, AND THAT IS DELIBERATE.        │
 * │                                                                          │
 * │ This file used to be a SOCKET: `ART = null` meant "the room draws its    │
 * │ own people" and pointing it at an asset switched them out. That existed  │
 * │ while the art question was open. It is closed: the cast is generated     │
 * │ in-house, the hand-drawn `Character.tsx` is deleted, and there is        │
 * │ exactly ONE way a person can be drawn.                                  │
 * │                                                                          │
 * │ Keeping a dead fallback would mean two drawings that must be kept in     │
 * │ step forever, and the one nobody looks at is the one that rots.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ FILE NAMES ARE A CONTRACT WITH `scripts/cut-cast.ps1`.                │
 * │                                                                          │
 * │   art/cast/cast-N.png      one strip per character, six cells            │
 * │   art/furniture/<name>.png one file per floor object                     │
 * │   art/wall/<name>.png      one file per wall object                      │
 * │                                                                          │
 * │ Renaming a file here without renaming it in the splitter produces a      │
 * │ build that still compiles and a room with a hole in it.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── ⚠ PROVENANCE IS A REQUIRED FIELD ──────────────────────────────────────
 *
 * A file whose origin nobody can state is a file that must not ship. Making it
 * required means the question is answered when the asset arrives, not during a
 * licence review two years later. Everything here is generated in-house, so the
 * answer is short — but it is still written down.
 */

/**
 * One cell of a character strip, in the strip's own pixels.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ THESE THREE NUMBERS ARE OUTPUTS OF `scripts/cut-cast`, NOT CHOICES.    │
 * │                                                                          │
 * │ The v3 sheets arrived at 2048×768 with the figures NOT uniform: standing │
 * │ height measured 658…711 px across the five (an 8% spread) and the floor  │
 * │ line 708…744. Both had to be normalised before any of this meant         │
 * │ anything, because the office has exactly ONE `CH_H`: a sheet 8% off      │
 * │ makes every number derived from it — shadow width, seat height, the      │
 * │ spacing of ring slots — silently wrong for that one person.              │
 * │                                                                          │
 * │   BODY_H 690  near the top of the measured range, so no sheet is         │
 * │                upscaled by more than 5%                                  │
 * │   CELL.h 720  the tallest frame after scaling is 697 (c0's `walk4`)      │
 * │   CELL.w 480  the widest is 418 (c4's `walk3`), leaving the 6% side      │
 * │                margin the sheets were authored with                      │
 * │                                                                          │
 * │ ⚠ The horizontal anchor is the HIP, not the bounding box. A walk frame's │
 * │ box stretches around the extended leg, so centring on it slides the      │
 * │ torso sideways every stride.                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const CELL = { w: 480, h: 720 } as const;

/**
 * The figure's own height inside a cell, for the STANDING poses. The renderer
 * scales `CELL.h` so this lands on `CH_H`, which is why a person comes out the
 * right size next to the furniture whatever the strip was authored at.
 */
export const BODY_H = 690;

/**
 * Frame order inside a strip. ⚠ POSITIONAL — the splitter writes cells in this
 * order and the CSS steps through `walk` by index, so a reorder here without a
 * reorder there animates somebody's arm into their head.
 */
export const FRAMES = { stand: 0, walk: [1, 2, 3, 4], sit: 5 } as const;

export interface CastSprite {
  /** The strip, imported as a URL. */
  src: string;
  /** REQUIRED. Who may use it and under what terms. */
  licence: string;
  /** REQUIRED. Where it came from, so the claim above can be checked. */
  source: string;
  /**
   * 🔴 A PER-SHEET RENDER SCALE, and it is a DESIGN CORRECTION, not a bug fix.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MEASURED FIRST, BECAUSE "THEY LOOK SHORT" HAS TWO CAUSES.                │
   * │                                                                          │
   * │ Alpha bounding box of the `stand` cell on all five v3 strips:            │
   * │   689 · 689 · 690 · 689 · 690  against `BODY_H` 690.                     │
   * │ So the normaliser did its job and **nothing is mis-scaled**. Three of    │
   * │ the five simply carry more of that height in HAIR and head, which reads  │
   * │ as a shorter person at the same total height — a PROPORTION difference,  │
   * │ and no amount of re-cutting the sheets would change it.                  │
   * │                                                                          │
   * │ ⚠ Which is why this is a number per sheet rather than a fix to           │
   * │ `cut-cast`: it says *this drawing is rendered larger*, on purpose, and   │
   * │ the day those three are redrawn it goes back to 1.                       │
   * │                                                                          │
   * │ It scales the whole cell from the FEET, so the anchor is untouched and   │
   * │ nobody floats. The ground shadow scales with it — a bigger person casts  │
   * │ a bigger shadow, and leaving it behind is how a body sits on a puddle.   │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  scale?: number;
  /**
   * 🔴 THE HEIGHT OF THE `sit` CELL'S FIGURE, IN STRIP PIXELS. Measured, not chosen.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE SEATED POSE SITS TOO LOW ON FOUR OF THE FIVE, AND THE NUMBERS SAY    │
   * │ WHICH FOUR BEFORE ANYBODY LOOKS.                                         │
   * │                                                                          │
   * │ Every cell in every strip is anchored at the SAME bottom edge (y 719),   │
   * │ which is right for the standing and walking poses — the anchor is the    │
   * │ feet. The `sit` cells are anchored there too, and their figures are not  │
   * │ the same height:                                                         │
   * │                                                                          │
   * │   c0 546 · c1 498 · c2 492 · c3 497 · **c4 448**                         │
   * │                                                                          │
   * │ So a seated c4 is 98 strip-pixels shorter than a seated c0 while both    │
   * │ start at the same line — it sinks into the stool. The user reported      │
   * │ exactly this ranking, unprompted: *"characters 2, 3, 4 a little; 5 is    │
   * │ the worst"*. c1/c2/c3 are the little ones, c4 is the worst. The          │
   * │ measurement and the complaint are the same fact.                         │
   * │                                                                          │
   * │ ⇒ `sitLift` raises the seated cell by the difference from the tallest,   │
   * │ so all five seated silhouettes stand off the seat by the same amount.    │
   * │ Three magic numbers would have done the same thing and told nobody why.  │
   * │                                                                          │
   * │ ⚠ THE SHADOW DOES NOT MOVE. The lift is a correction to a DRAWING; the   │
   * │ person is still standing on the same floor, and lifting their contact    │
   * │ ellipse with them is how somebody ends up hovering.                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  sitH: number;
}

const IN_HOUSE = {
  licence: 'Generated in-house — no third-party asset, no licence to comply with',
  source: 'Google AI Studio, prompts in docs/SPEC-office-art.md',
} as const;

/**
 * ⚠ INDEXED BY `CastMember.id`, and that index is STORED in `layout.cast`.
 * Reordering this array changes who every existing employee looks like.
 * Append only — the same rule `core/cast.ts` states for the table itself.
 *
 * Shorter than `CAST` ⇒ it wraps, so a ten-strong office runs on five strips
 * until more are drawn.
 */
/**
 * ⚠ `sitH` IS MEASURED OFF THE SHIPPED PNG, and `scripts/cut-cast.ps1` prints it
 * on every cut. Re-cut a sheet without copying the new number here and the seated
 * figure floats or sinks — silently, and only when somebody happens to be resting.
 *
 * 07/09: c1…c4 re-rolled (v4) for the SIT POSE alone. The seated figures came back
 * at 0.762…0.782 of standing height against c0's 0.792, where v3 had them at
 * 0.649…0.723. The correction that used to be worth up to 28 world units is now
 * worth 6, and `MAX_SIT_LIFT` came down with it.
 *
 * ⚠ THE WHOLE SHEET WAS REPLACED, NOT THE SIT CELL — §2 of the art spec: a re-roll
 * replaces the sheet or nothing. c0 was not re-rolled and keeps its v3 strip.
 */
export const SPRITES: readonly CastSprite[] = [
  { src: cast0, ...IN_HOUSE, sitH: 546 },
  { src: cast1, ...IN_HOUSE, sitH: 546 },
  // 1.1, not 1.2 — seen at the shipping size, a fifth taller made them the tall
  // ones instead of the short ones, which is the same complaint from the other end.
  { src: cast2, ...IN_HOUSE, scale: 1.1, sitH: 546 },
  { src: cast3, ...IN_HOUSE, scale: 1.1, sitH: 546 },
  { src: cast4, ...IN_HOUSE, scale: 1.1, sitH: 546 },
];

/** The tallest seated figure. Everybody else is raised to meet it. */
const SIT_TALLEST = Math.max(...SPRITES.map((s) => s.sitH));

/**
 * 🔴 THE WIRE TO `core/cast.ts`, CHECKED AT BOOT RATHER THAN DESCRIBED.
 *
 * `assignCast` deals faces against `FACE_COUNT`; this file owns how many faces
 * there actually are. Add a sixth strip without raising that number and the
 * office quietly goes on using five while a drawing sits unused — the exact
 * class of failure that produced identical twins in the first place, and one
 * nothing would report. A comment saying "keep these in step" is not a
 * mechanism; a throw on the line that loads the room is.
 */
if (SPRITES.length !== FACE_COUNT) {
  throw new Error(
    `art/manifest: ${SPRITES.length} cast strips but core/cast.ts says FACE_COUNT=${FACE_COUNT}`,
  );
}

/**
 * Who draws this cast member. Wraps rather than throwing: a cast table longer
 * than the sprite list is a normal intermediate state, and a missing face is a
 * worse failure than a repeated one.
 */
export function spriteFor(cast: number): CastSprite {
  return SPRITES[((cast % SPRITES.length) + SPRITES.length) % SPRITES.length]!;
}

/** How much bigger than `CH_H` this character is drawn. 1 unless stated. */
export function scaleFor(cast: number): number {
  return spriteFor(cast).scale ?? 1;
}

/**
 * How far to raise this character's SEATED cell, as a fraction of the rendered
 * cell height. → `CastSprite.sitH`
 *
 * Derived, never typed: the day a sheet is re-cut, one measured number changes and
 * the lift follows. A hand-tuned offset per character would have to be re-tuned by
 * whoever notices, which is nobody.
 */
export function sitLiftFor(cast: number): number {
  return (SIT_TALLEST - spriteFor(cast).sitH) / CELL.h;
}

/**
 * 🔴 THE SECOND WIRE TO `core/`, AND THE SAME KIND OF THROW AS `FACE_COUNT`.
 *
 * `CHESS_SEAT` places the player forward of their stool by more than the largest
 * lift, so that even the most-raised sheet's feet still land behind the chess
 * table and are occluded by it. That rule lives in `core/office-floor.ts` and
 * cannot see these sheets — so the ceiling is declared there and checked here.
 *
 * Re-cut a strip with a shorter `sit` cell and this fails on the line that loads
 * the room, rather than seating somebody on the chess pieces six weeks later.
 */
const liftWorld = (i: number): number => (sitLiftFor(i) * CH_H * CELL.h * (SPRITES[i]!.scale ?? 1)) / BODY_H;
const worstLift = Math.max(...SPRITES.map((_, i) => liftWorld(i)));
if (worstLift > MAX_SIT_LIFT) {
  throw new Error(
    `art/manifest: a seated sprite lifts ${worstLift.toFixed(1)} world units, over core's MAX_SIT_LIFT=${MAX_SIT_LIFT}`,
  );
}
