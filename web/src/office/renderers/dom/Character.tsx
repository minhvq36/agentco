import { memo } from 'react';

import { CAST, type AccessoryId, type CastMember, type HairId, type HeadwearId } from '@core/cast';

/**
 * ONE DRAWING. Ten characters are ten CONFIGURATIONS of this function.
 * → docs/SPEC-office-animation.md §2b · §4
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS WHAT KEEPS THE ART FROM DRIFTING — not a framework.              │
 * │                                                                          │
 * │ A game engine supplies a runtime (a loop, a scene graph, sprite          │
 * │ batching). It supplies no style at all, and it cannot stop ten drawings  │
 * │ disagreeing with each other. What stops that is there being ONE drawing: │
 * │ drift is a disease of independent assets, and this file owns none.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 PROPORTIONS — the first cut got this WRONG and it is worth recording. │
 * │                                                                          │
 * │ It was drawn at 2.6 heads tall, out of rounded rectangles, with no       │
 * │ contour line. The user's verdict was one word, and correct. Two separate │
 * │ mistakes were hiding in it:                                              │
 * │                                                                          │
 * │  ① 2.6 heads is CHIBI — a blob with a face. The style actually asked     │
 * │    for is the standard animation figure, ~5–6 heads, where the legs are  │
 * │    HALF the total height. That single ratio is most of what separates    │
 * │    "a character" from "a snowman".                                       │
 * │  ② No outline. Flat fills alone read as clip-art; the same shapes with   │
 * │    a contour stroke read as drawn. Every part below carries `ch-out`.    │
 * │                                                                          │
 * │ ⚠ AND THE ROOM HAD TO GROW WITH THEM. A 70-unit person in a 1600-unit    │
 * │ room is 23 people wide — a warehouse. At 133 the room reads as a room,   │
 * │ and a 25-unit head is big enough for eyes that actually land.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE SECOND CUT — measured against a screenshot, not against argument. │
 * │                                                                          │
 * │ A contact sheet was rendered and LOOKED AT, and four things were wrong:  │
 * │                                                                          │
 * │  ① LIMBS WERE STICKS. A 7-unit sleeve on a 32-unit shoulder span reads   │
 * │    as wire, and no amount of shading rescues it. Widths below are now    │
 * │    stated as named constants and are ~40% thicker. This — not the head   │
 * │    ratio — was what made the figure gaunt, so the ratio DID NOT MOVE:    │
 * │    the recorded 5–6 head verdict still stands and is not being reopened. │
 * │  ② THE FACE HAD NO BROW. Two eyes and a hairline curve is a mask. One    │
 * │    stroke per eye is the cheapest expression in the whole drawing.       │
 * │  ③ TEN PEOPLE READ AS ONE. Every hair variant was the same skull cap     │
 * │    with a detail added inside the silhouette, so at 25 units they were   │
 * │    indistinguishable. A hairstyle now has to change the OUTLINE — wider  │
 * │    than the head, taller than the head, or hanging below the jaw — or    │
 * │    it does not count as a hairstyle.                                     │
 * │  ④ `sit` READ AS STANDING IN A HOLE. Seated means the hips DROP and the  │
 * │    thighs go FORWARD. Shortening the legs is not sitting.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 ARTICULATION — why a rigid limb looks worse than a 2-frame flipbook.  │
 * │                                                                          │
 * │ The reference pack's walk is TWO authored frames. This walk is a         │
 * │ continuous CSS rotation at the display's own frame rate, so it is        │
 * │ already the smoother of the two. What it lacked was JOINTS: a leg that   │
 * │ is one rigid stick pivoting at the hip reads as a pair of compasses no   │
 * │ matter how many frames per second it gets.                               │
 * │                                                                          │
 * │ So each limb is now TWO nested groups — hip→knee, shoulder→elbow — and   │
 * │ the upper body counter-twists against the hips. Still ZERO JavaScript:   │
 * │ the loop moves the body, CSS swings the parts, and `apply()` is          │
 * │ unchanged. A joint costs one `<g>`; a keyframe costs nothing per frame.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ STYLE, NOT CHARACTER. Proportions, flat cel colour, a contour line and big
 * eyes are genre conventions and belong to nobody. A specific character — its
 * design, its name, its colour scheme together — is protected. Nothing in `CAST`
 * may add up to one; the fence is written out in `core/cast.ts`.
 *
 * Origin is the FEET, centred. The body grows upward (negative y), so dropping
 * somebody at a floor position needs no height correction anywhere.
 */

// ── the construction grid. Every number below is one of these, never "about
//    right": a part positioned by eye is how the tenth character stops
//    matching the first.
export const TOTAL_H = 133;
const HEAD_TOP = -133;
const CHIN = -108; //   head = 25 tall  ⇒ 5.3 heads. NOT MOVED — see the box above.
const NECK = -101;
const SHOULDER_Y = -99;
const WAIST_Y = -70;
const HIP_Y = -58; //   legs = 58  ⇒ 44% of height, the ratio that reads as adult
const KNEE_Y = -30;
const SHOE_Y = -9;
const ELBOW_Y = SHOULDER_Y + 19;

const HEAD_W = 10; //   half-width. 9 → 10: a rounder skull carries a brow.
const SHOULDER = 16; // half-width
const WAIST = 12.5;
const HIP = 13.5;
const EYE_Y = -121;
const EYE_X = 4.4;
/**
 * ⚠ THE BROW HAS TO CLEAR THE EYE. At 5.6 units above the pupil with a 1.9
 * stroke, brow and eye merged into one dark band across the face and every
 * character read as if wearing sunglasses — worse than having no brow at all.
 * The gap, not the stroke, is what makes it read as an eyebrow.
 */
const BROW_Y = EYE_Y - 7.4;

/**
 * ⚠ LIMB WIDTHS ARE NAMED, because the first cut typed them inline and that is
 * exactly how a drawing ends up with a forearm thinner than its own outline.
 * These are HALF-widths, and they are the fix for "the figure looks like wire".
 */
const UPPER_ARM_W = 5; //  was ~3.5
const FOREARM_W = 4; //    was 2.8
const HAND_R = 4.4; //     was 3.4
const THIGH_W = 7; //      was 5
const SHIN_W = 5.4; //     was 4

/** Seated: how far the hips drop. Sitting is a DROP plus a fold, never a trim. */
const SIT_DROP = 22;

/**
 * How far a limb's lower half reaches back OVER its own pivot. → the `Leg`
 * comment. Any rotating joint needs this; a butt-joint at the pivot tears open.
 */
const JOINT_LAP = 3.5;

export type Pose = 'front' | 'side' | 'sit';

/**
 * VOLUME, on a flat drawing. → the user's note: *"2D is fine, but it has to
 * look like something — give it shading"*.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE GRADIENT, REUSED BY EVERY PART, INSTEAD OF SHADING BY HAND.          │
 * │                                                                          │
 * │ Cel shading normally means authoring a second shape per volume — ten      │
 * │ characters × six parts of hand-drawn shadow, and every one of them is a   │
 * │ chance for the tenth to stop matching the first. These gradients are in   │
 * │ `objectBoundingBox` units, so the SAME two definitions light every shape  │
 * │ from the same direction at the right size, whatever the shape is.         │
 * │                                                                          │
 * │ ⚠ The light comes from the UPPER LEFT and never moves. A scene where       │
 * │ parts are lit from different sides is the thing that reads as "wrong"     │
 * │ without a viewer being able to say why.                                   │
 * │                                                                          │
 * │ Cost: two extra paths per part, no filter, no blur, no raster. Filters    │
 * │ (`feGaussianBlur`, `feDropShadow`) are the expensive ones — they force an │
 * │ offscreen buffer per element, on every frame the character moves.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Rendered once inside each `<svg>` that draws a character. Duplicate ids
 * across two `<svg>`s in one document are harmless — the definitions are
 * identical — and it keeps the picker and the contact sheet from depending on
 * the room being mounted.
 */
export function CharacterDefs() {
  return (
    <defs>
      <linearGradient id="chShade" x1="0" y1="0" x2="1" y2="0.4">
        <stop offset="0.38" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#241d14" stopOpacity="0.26" />
      </linearGradient>
      <linearGradient id="chLight" x1="0" y1="0" x2="0.75" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
        <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      {/* The ground shadow is SOFT, and it is soft by gradient rather than by
          blur: a blur filter here would cost an offscreen buffer per person on
          every frame they move. */}
      <radialGradient id="chGround">
        <stop offset="0" stopColor="#241d14" stopOpacity="0.34" />
        <stop offset="0.65" stopColor="#241d14" stopOpacity="0.16" />
        <stop offset="1" stopColor="#241d14" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** A solid part: the fill, then the shade, then the highlight. Same geometry, three passes. */
function VPath({ d, fill, className = '' }: { d: string; fill: string; className?: string }) {
  return (
    <>
      <path className={`ch-out ${className}`} fill={fill} d={d} />
      <path className="ch-vol" fill="url(#chShade)" d={d} />
      <path className="ch-vol" fill="url(#chLight)" d={d} />
    </>
  );
}

function VRect(p: { x: number; y: number; width: number; height: number; rx: number; fill: string }) {
  const { fill, ...box } = p;
  return (
    <>
      <rect className="ch-out" fill={fill} {...box} />
      <rect className="ch-vol" fill="url(#chShade)" {...box} />
    </>
  );
}

function VCircle(p: { cx: number; cy: number; r: number; fill: string }) {
  const { fill, ...c } = p;
  return (
    <>
      <circle className="ch-out" fill={fill} {...c} />
      <circle className="ch-vol" fill="url(#chShade)" {...c} />
    </>
  );
}

export interface CharacterProps {
  cast: number;
  pose?: Pose;
  /** Which way they face. The other direction is a flip, NOT a second drawing. */
  facing?: 1 | -1;
}

export const Character = memo(function Character({ cast, pose = 'front', facing = 1 }: CharacterProps) {
  const m: CastMember = CAST[cast % CAST.length]!;
  const side = pose === 'side';
  const sit = pose === 'sit';

  /**
   * Two colours per character, handed down as custom properties so every path
   * says `var(--g)` / `var(--s)` and nothing hard-codes a value. The tokens
   * themselves are defined once per theme in `office.css`.
   */
  const skin = `var(--skin-${m.skin})`;
  const garment = `var(--cast-${m.garment})`;
  const trousers = `var(--cast-${((m.garment + 4) % 10) + 1})`;

  /**
   * ⚠ A PROFILE IS NARROWER, and that is the whole trick. The first cut drew
   * `side` as `front` with one arm hidden, which is why it read as the same
   * picture. A body turned ninety degrees loses most of its shoulder span.
   */
  const sw = side ? SHOULDER * 0.72 : SHOULDER;
  const ww = side ? WAIST * 0.78 : WAIST;
  const hw = side ? HIP * 0.78 : HIP;

  /**
   * Everything above the legs rides on the pelvis, so it can twist as one.
   *
   * ⚠ THE SEATED DROP IS ON AN OUTER `<g>`, NOT ON `.ch-torso`. A CSS
   * `transform` (the breathing keyframe) REPLACES the element's `transform`
   * attribute rather than composing with it, so putting both on one node makes
   * a seated person stand back up the moment they inhale. Two nodes, no bug.
   */
  const upper = (
    <g transform={sit ? `translate(0 ${SIT_DROP})` : undefined}>
    <g className="ch-torso" style={{ transformOrigin: `0px ${HIP_Y}px` }}>
      {/* ── the far arm goes BEHIND the torso, the near one in front. Drawing
             both on top is the single most obvious "flat" tell. */}
      {!side && <Arm x={-sw + 3} fill={garment} skin={skin} cls="ch-arm-b" foreCls="ch-fore-b" />}

      {/* ── torso: shoulders → waist, tapered. A trapezoid with a soft top is
             the whole difference between a shirt and a box. */}
      <VPath
        fill={garment}
        d={`M ${-sw} ${SHOULDER_Y + 4}
            C ${-sw} ${SHOULDER_Y - 3} ${-sw + 5} ${NECK - 3} ${-4} ${NECK - 3}
            L 4 ${NECK - 3}
            C ${sw - 5} ${NECK - 3} ${sw} ${SHOULDER_Y - 3} ${sw} ${SHOULDER_Y + 4}
            L ${ww} ${WAIST_Y}
            L ${-ww} ${WAIST_Y} Z`}
      />
      {/* The collar — one curve, and the torso stops being a bag. */}
      <path className="ch-line" d={`M -4.5 ${NECK - 2.5} q 4.5 5 9 0`} />
      {/* hips */}
      <VPath fill={trousers} d={`M ${-ww} ${WAIST_Y} L ${ww} ${WAIST_Y} L ${hw} ${HIP_Y + 2} L ${-hw} ${HIP_Y + 2} Z`} />

      {/* ⚠ In profile the near arm hangs in FRONT of the ribs, not off the edge
             of a shoulder that is no longer there. Leaving it at the front
             view's x is most of why `side` used to read as `front`. */}
      <Arm x={side ? 3 : sw - 3} fill={garment} skin={skin} cls="ch-arm-a" foreCls="ch-fore-a" />

      {/* ── neck, then head. An EGG with a chin, never a rounded rectangle. */}
      <VRect x={-3.8} y={CHIN - 2} width={7.6} height={9} rx={2.5} fill={skin} />
      <VPath
        fill={skin}
        d={`M ${-HEAD_W} ${HEAD_TOP + 10}
            C ${-HEAD_W} ${HEAD_TOP - 2} ${-4} ${HEAD_TOP - 3} 0 ${HEAD_TOP - 3}
            C 4 ${HEAD_TOP - 3} ${HEAD_W} ${HEAD_TOP - 2} ${HEAD_W} ${HEAD_TOP + 10}
            C ${HEAD_W} ${HEAD_TOP + 19} ${5} ${CHIN} 0 ${CHIN}
            C ${-5} ${CHIN} ${-HEAD_W} ${HEAD_TOP + 19} ${-HEAD_W} ${HEAD_TOP + 10} Z`}
      />
      {/* A profile needs a nose, or the head is a ball with an eye painted on. */}
      {side && (
        <VPath fill={skin} d={`M ${HEAD_W - 0.5} ${EYE_Y + 1} l 3.4 3 l -3.4 1.6 z`} />
      )}

      <Hair id={m.hair} side={side} />
      <Headwear id={m.headwear} />

      <Face id={m.id} side={side} />

      <Accessory id={m.accessory} skin={skin} />
    </g>
    </g>
  );

  return (
    <g className={`ch ch-${pose}`} transform={facing === -1 ? 'scale(-1,1)' : undefined}>
      {/* What puts somebody ON the floor rather than floating above it. Soft
          by gradient, never by a blur filter. */}
      <ellipse className="ch-shadow" cx={1} cy={1} rx={22} ry={6} />

      {/* ── legs. Their own <g> so CSS can swing them; JS never touches a limb. */}
      {sit ? (
        <>
          {/* Closer together than a standing stance: seated thighs form one lap,
              and a gap between them undoes the foreshortening. */}
          <SeatedLeg x={-4} fill={trousers} skin={skin} />
          <SeatedLeg x={4} fill={trousers} skin={skin} />
        </>
      ) : (
        <>
          {/* ⚠ In profile the legs are IN LINE, not side by side — a stance as
                 wide as the front view is the other half of why `side` used to
                 read as `front`. */}
          <Leg x={side ? -2.5 : -6} fill={trousers} skin={skin} cls="ch-leg-b" shinCls="ch-shin-b" />
          <Leg x={side ? 2.5 : 6} fill={trousers} skin={skin} cls="ch-leg-a" shinCls="ch-shin-a" />
        </>
      )}

      {upper}
    </g>
  );
});

/**
 * Thigh, then a KNEE, then shin and shoe.
 *
 * ⚠ The knee is a nested `<g>` with its own transform origin, which is the only
 * reason the walk stops reading as a compass. Two groups, no JavaScript.
 */
function Leg({
  x,
  fill,
  skin,
  cls,
  shinCls,
}: {
  x: number;
  fill: string;
  skin: string;
  cls: string;
  shinCls: string;
}) {
  return (
    <g className={`ch-leg ${cls}`} style={{ transformOrigin: `${x}px ${HIP_Y}px` }}>
      {/* trouser leg, down to the knee */}
      <VPath
        fill={fill}
        d={`M ${x - THIGH_W} ${HIP_Y} L ${x + THIGH_W} ${HIP_Y} L ${x + THIGH_W - 1} ${KNEE_Y} L ${x - THIGH_W + 1} ${KNEE_Y} Z`}
      />
      <g className={`ch-shin ${shinCls}`} style={{ transformOrigin: `${x}px ${KNEE_Y}px` }}>
        {/*
          ⚠ THE SHIN STARTS ABOVE THE KNEE, NOT AT IT.
          Two shapes that merely TOUCH at the pivot come apart the moment the
          joint rotates: the corners swing out of the socket and leave a notch
          in the leg. Caught at 4× on a paused walk cycle — invisible in a still
          contact sheet, which is exactly the class of defect a screenshot of a
          FROZEN pose cannot show you. Overlapping by `JOINT_LAP` keeps the
          socket covered through the whole 30° of bend.
        */}
        <VPath
          fill={skin}
          d={`M ${x - SHIN_W} ${KNEE_Y - JOINT_LAP} L ${x + SHIN_W} ${KNEE_Y - JOINT_LAP} L ${x + SHIN_W - 1} ${SHOE_Y} L ${x - SHIN_W + 1} ${SHOE_Y} Z`}
        />
        {/* shoe — pointing the way the body faces, which is what stops a walk
            cycle reading as a wobble */}
        <VPath
          fill="var(--shoe)"
          d={`M ${x - SHIN_W} ${SHOE_Y} L ${x + SHIN_W} ${SHOE_Y} L ${x + SHIN_W + 4} -2 a 2 2 0 0 1 -2 2 L ${x - SHIN_W} 0 Z`}
        />
      </g>
    </g>
  );
}

/**
 * Seated, drawn FRONT-ON. → the second cut's defect ④.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ A SEATED PERSON SEEN FROM THE FRONT DOES NOT HAVE HORIZONTAL THIGHS —  │
 * │ THEY POINT AT THE VIEWER.                                                │
 * │                                                                          │
 * │ The first attempt swung the thigh sideways across the picture, which is  │
 * │ the PROFILE of sitting and reads, front-on, as a person doing the        │
 * │ splits. Foreshortened, the thigh is a short block WIDER than the         │
 * │ standing leg, the knee is its lower edge, and the shin drops straight    │
 * │ down from there.                                                         │
 * │                                                                          │
 * │ The three cues that actually carry it, in order of strength:             │
 * │   ① the whole body is LOWER (`SIT_DROP`)                                 │
 * │   ② the thigh is WIDER than a standing leg (foreshortening)              │
 * │   ③ the shin is SHORT, because the knee is now high                      │
 * │ Shortening the legs alone gives none of these, which is why the first    │
 * │ cut read as "standing in a hole".                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * No chair is drawn here on purpose — chairs belong to the room, a person
 * belongs to this file.
 */
function SeatedLeg({ x, fill, skin }: { x: number; fill: string; skin: string }) {
  const hip = HIP_Y + SIT_DROP;
  const knee = hip + 8;
  /**
   * ⚠ THE THIGH MUST BE WIDER THAN IT IS TALL. Attempt two made it 19×19 — a
   * square, which reads as an ordinary upper leg and left the whole pose saying
   * "a shorter person" instead of "a seated person". Foreshortening is a RATIO,
   * not a length: 22 wide against 15 tall is what the eye reads as a thigh
   * pointing at it.
   */
  const tw = THIGH_W + 4;
  return (
    <>
      {/* thigh — wide, short, ending in a rounded knee at the front */}
      <VPath
        fill={fill}
        d={`M ${x - tw} ${hip - 7} L ${x + tw} ${hip - 7} L ${x + tw} ${knee - 3}
            a 3 3 0 0 1 -3 3 L ${x - tw + 3} ${knee} a 3 3 0 0 1 -3 -3 Z`}
      />
      {/* The knee crease. One stroke, and the lap stops being a block of colour
          — this is the cue that carries the pose at room scale. */}
      <path className="ch-line" d={`M ${x - tw + 2.5} ${knee - 4} h ${tw * 2 - 5}`} />
      {/* shin — short, because a seated knee sits high */}
      <VPath
        fill={skin}
        d={`M ${x - SHIN_W} ${knee - 1} L ${x + SHIN_W} ${knee - 1} L ${x + SHIN_W - 1} ${SHOE_Y} L ${x - SHIN_W + 1} ${SHOE_Y} Z`}
      />
      <VPath
        fill="var(--shoe)"
        d={`M ${x - SHIN_W} ${SHOE_Y} L ${x + SHIN_W} ${SHOE_Y} L ${x + SHIN_W + 4} -2 a 2 2 0 0 1 -2 2 L ${x - SHIN_W} 0 Z`}
      />
    </>
  );
}

/** Upper arm, then an ELBOW, then forearm and hand. */
function Arm({
  x,
  fill,
  skin,
  cls,
  foreCls,
}: {
  x: number;
  fill: string;
  skin: string;
  cls: string;
  foreCls: string;
}) {
  return (
    <g className={`ch-arm ${cls}`} style={{ transformOrigin: `${x}px ${SHOULDER_Y + 2}px` }}>
      <VPath
        fill={fill}
        d={`M ${x - UPPER_ARM_W} ${SHOULDER_Y - 1} L ${x + UPPER_ARM_W} ${SHOULDER_Y - 1} L ${x + UPPER_ARM_W - 0.6} ${ELBOW_Y} L ${x - UPPER_ARM_W + 0.6} ${ELBOW_Y} Z`}
      />
      {/* Same socket rule as the knee — see `Leg`. */}
      <g className={`ch-fore ${foreCls}`} style={{ transformOrigin: `${x}px ${ELBOW_Y}px` }}>
        <VRect
          x={x - FOREARM_W}
          y={ELBOW_Y - JOINT_LAP}
          width={FOREARM_W * 2}
          height={20 + JOINT_LAP}
          rx={3.2}
          fill={skin}
        />
        <VCircle cx={x} cy={ELBOW_Y + 21} r={HAND_R} fill={skin} />
      </g>
    </g>
  );
}

/**
 * The face. → the second cut's defect ②.
 *
 * ⚠ THE BROW IS THE EXPRESSION. Eyes alone are a mask; one short stroke above
 * each eye is the difference between "a figure" and "somebody". It is also the
 * cheapest thing in this file — two paths, no fill, no gradient.
 */
function Face({ id, side }: { id: number; side: boolean }) {
  const eyes = side ? [EYE_X + 1.2] : [-EYE_X, EYE_X];
  return (
    <>
      {/* Blush. Two soft ovals at 16% — below the level anybody notices, and
          the whole reason the skin stops reading as cardboard. */}
      {!side && (
        <>
          <ellipse className="ch-blush" cx={-EYE_X - 2.4} cy={EYE_Y + 5} rx={2.6} ry={1.7} />
          <ellipse className="ch-blush" cx={EYE_X + 2.4} cy={EYE_Y + 5} rx={2.6} ry={1.7} />
        </>
      )}

      <g className="ch-eyes" style={{ animationDelay: `${(id % 7) * 0.9 + 1.2}s` }}>
        {eyes.map((x) => (
          <g key={x}>
            <ellipse className="ch-ink" cx={x} cy={EYE_Y} rx={2.7} ry={3.5} />
            {/* the highlight. Two units of white and the face is alive. */}
            <circle className="ch-glint" cx={x - 0.8} cy={EYE_Y - 1.4} r={1.1} />
          </g>
        ))}
      </g>

      {/* brows — angled very slightly down toward the nose, which reads as
          "attentive". Level brows read as vacant, raised ones as alarmed. */}
      {eyes.map((x) => (
        <path
          key={`b${x}`}
          className="ch-brow"
          d={`M ${x - 3} ${BROW_Y + (x < 0 ? 0.7 : 0)} q 3 -1.7 6 ${x < 0 ? -0.7 : 0.7}`}
        />
      ))}

      {/* the mouth. Wider and deeper than the first cut's hairline tick. */}
      <path
        className="ch-smile"
        d={side ? `M ${EYE_X - 0.5} ${EYE_Y + 9} q 2.6 2.8 5 0.4` : `M -3 ${EYE_Y + 9} q 3 3.4 6 0`}
      />
    </>
  );
}

/**
 * Hair. → the second cut's defect ③.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ A HAIRSTYLE THAT DOES NOT CHANGE THE SILHOUETTE IS NOT A HAIRSTYLE.    │
 * │                                                                          │
 * │ The first cut drew one skull cap and then added detail INSIDE it, so at  │
 * │ a 20-unit head every variant was the same dark helmet and ten people     │
 * │ read as one person in ten shirts. Each branch below now has to leave the │
 * │ head outline in a way you can name: WIDER than the skull, TALLER than    │
 * │ the skull, or HANGING past the jaw.                                      │
 * │                                                                          │
 * │ ⚠ `short` and `buzz` hug the skull ON PURPOSE — flat, never standing up. │
 * │ Spiked hair is the one silhouette explicitly ruled out for this cast.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function Hair({ id, side }: { id: HairId; side: boolean }) {
  const w = HEAD_W;
  const H = 'var(--hair)';
  const top = HEAD_TOP;

  /** The skull cap: sits ON the head outline, with a fringe sweeping one way. */
  const cap = (
    <VPath
      fill={H}
      d={`M ${-w - 0.8} ${top + 12}
          C ${-w - 0.8} ${top - 4} ${w + 0.8} ${top - 4} ${w + 0.8} ${top + 12}
          C ${w + 0.8} ${top + 6} ${4} ${top + 9} ${1} ${top + 14}
          C ${-1} ${top + 8} ${-5} ${top + 7} ${-w - 0.8} ${top + 12} Z`}
    />
  );

  switch (id) {
    /* ── MALE, FLAT. Hugs the skull; the outline barely leaves the head. */
    case 'buzz':
      return (
        <VPath
          fill={H}
          d={`M ${-w} ${top + 9} C ${-w} ${top - 1} ${w} ${top - 1} ${w} ${top + 9}
              C ${w} ${top + 5} ${-w} ${top + 5} ${-w} ${top + 9} Z`}
        />
      );

    /* Flat top, a side part, and sideburns down to the ear line. NOT spiked. */
    case 'short':
      return (
        <>
          {cap}
          <path className="ch-line" d={`M ${-w + 3} ${top + 4} q 4 2.5 8 1.5`} />
          {[-1, 1].map((s) => (
            <VPath
              key={s}
              fill={H}
              d={`M ${s * (w + 0.4)} ${top + 9} L ${s * (w + 0.8)} ${top + 17} L ${s * (w - 2)} ${top + 16} L ${s * (w - 2)} ${top + 9} Z`}
            />
          ))}
        </>
      );

    /* ── FEMALE ①: BOB. Flares WIDER than the skull and squares off at the jaw. */
    case 'bob':
      return (
        <>
          {cap}
          {[-1, 1].map((s) => (
            <VPath
              key={s}
              fill={H}
              d={`M ${s * (w + 0.6)} ${top + 6}
                  C ${s * (w + 4.5)} ${top + 14} ${s * (w + 4.2)} ${top + 22} ${s * (w + 3.4)} ${top + 27}
                  L ${s * (w - 2.5)} ${top + 26}
                  C ${s * (w - 1)} ${top + 18} ${s * (w - 1)} ${top + 12} ${s * (w - 2)} ${top + 8} Z`}
            />
          ))}
        </>
      );

    /* ── FEMALE ②: PONYTAIL. A real tail, OUTSIDE the head, hanging back-down. */
    case 'ponytail':
      return (
        <>
          <VPath
            fill={H}
            d={`M ${-w + 1} ${top + 7}
                C ${-w - 7} ${top + 11} ${-w - 10} ${top + 24} ${-w - 6.5} ${top + 38}
                C ${-w - 3} ${top + 40} ${-w - 1.5} ${top + 36} ${-w - 2.5} ${top + 30}
                C ${-w - 4} ${top + 22} ${-w - 2} ${top + 15} ${-w + 3} ${top + 13} Z`}
          />
          {/* the tie, so the tail reads as tied rather than as a stray lock */}
          <VRect x={-w - 4.6} y={top + 9} width={5.5} height={3.4} rx={1.6} fill="var(--wear)" />
          {cap}
        </>
      );

    /* ── FEMALE ③: BUN. Clearly TALLER than the skull. */
    case 'bun':
      return (
        <>
          <VCircle cx={0.5} cy={top - 5.5} r={6.4} fill={H} />
          <VRect x={-3} y={top - 1.5} width={6} height={3} rx={1.4} fill="var(--wear)" />
          {cap}
        </>
      );

    /* Long: past the shoulders, widening as it falls. */
    case 'long':
      return (
        <>
          {[-1, 1].map((s) => (
            <VPath
              key={s}
              fill={H}
              d={`M ${s * (w + 0.6)} ${top + 6}
                  C ${s * (w + 5)} ${top + 20} ${s * (w + 6.5)} ${top + 34} ${s * (w + 5)} ${top + 44}
                  L ${s * (w - 3)} ${top + 43}
                  C ${s * (w - 1)} ${top + 30} ${s * (w - 1)} ${top + 16} ${s * (w - 2.5)} ${top + 9} Z`}
            />
          ))}
          {cap}
        </>
      );

    /* Curly: volume on every side, so the outline is a cloud not a cap. */
    case 'curly':
      return (
        <>
          <VCircle cx={-w - 1.5} cy={top + 8} r={4.8} fill={H} />
          <VCircle cx={w + 1.5} cy={top + 8} r={4.8} fill={H} />
          <VCircle cx={-w + 2.5} cy={top - 0.5} r={5.6} fill={H} />
          <VCircle cx={w - 2.5} cy={top - 0.5} r={5.6} fill={H} />
          <VCircle cx={0} cy={top - 2.5} r={5.8} fill={H} />
          {cap}
        </>
      );

    /* Braids: two ropes hanging below the jaw, segmented so they read as braids. */
    case 'braids':
      return (
        <>
          {cap}
          {[-1, 1].map((s) => (
            <g key={s}>
              <VCircle cx={s * (w + 1.6)} cy={top + 19} r={3.6} fill={H} />
              <VCircle cx={s * (w + 2.4)} cy={top + 26} r={3.2} fill={H} />
              <VCircle cx={s * (w + 2.8)} cy={top + 32} r={2.6} fill={H} />
            </g>
          ))}
        </>
      );

    default:
      return side ? cap : cap;
  }
}

function Headwear({ id }: { id: HeadwearId }) {
  const w = HEAD_W;
  const W = 'var(--wear)';
  switch (id) {
    case 'cap':
      return (
        <>
          <VPath
            fill={W}
            d={`M ${-w - 1} ${HEAD_TOP + 10} C ${-w - 1} ${HEAD_TOP - 5} ${w + 1} ${HEAD_TOP - 5} ${w + 1} ${HEAD_TOP + 10} Z`}
          />
          <VPath fill={W} d={`M ${-w - 1} ${HEAD_TOP + 10} h ${2 * w + 9} a 2 2 0 0 1 0 4 h ${-2 * w - 9} z`} />
        </>
      );
    case 'beanie':
      return (
        <>
          <VPath
            fill={W}
            d={`M ${-w - 1} ${HEAD_TOP + 11} C ${-w - 1} ${HEAD_TOP - 7} ${w + 1} ${HEAD_TOP - 7} ${w + 1} ${HEAD_TOP + 11} Z`}
          />
          <VRect x={-w - 1.4} y={HEAD_TOP + 9} width={2 * w + 2.8} height={4.5} rx={2} fill={W} />
        </>
      );
    case 'headband':
      return <VRect x={-w - 1} y={HEAD_TOP + 8} width={2 * w + 2} height={3.6} rx={1.8} fill={W} />;
    case 'glassesUp':
      return (
        <g className="ch-line" fill="none">
          <circle cx={-EYE_X} cy={HEAD_TOP + 9} r={3.4} />
          <circle cx={EYE_X} cy={HEAD_TOP + 9} r={3.4} />
        </g>
      );
    default:
      return null;
  }
}

function Accessory({ id, skin }: { id: AccessoryId; skin: string }) {
  const W = 'var(--wear)';
  switch (id) {
    case 'glasses':
      return (
        <g className="ch-line" fill="none">
          <rect x={-EYE_X - 3.8} y={EYE_Y - 3.8} width={7.6} height={7.4} rx={2} />
          <rect x={EYE_X - 3.8} y={EYE_Y - 3.8} width={7.6} height={7.4} rx={2} />
          <path d={`M ${-EYE_X + 3.8} ${EYE_Y} L ${EYE_X - 3.8} ${EYE_Y}`} />
        </g>
      );
    case 'scarf':
      return (
        <>
          <VPath fill={W} d={`M -7.5 ${NECK - 4} h 15 a 3 3 0 0 1 0 7 h -15 a 3 3 0 0 1 0 -7 z`} />
          <VPath fill={W} d={`M 3 ${NECK + 1} l 5 12 l -5 2 z`} />
        </>
      );
    case 'badge':
      return <VRect x={4} y={SHOULDER_Y + 10} width={5.5} height={7.5} rx={1.2} fill={W} />;
    case 'earbuds':
      return (
        <>
          <VCircle cx={-HEAD_W} cy={EYE_Y + 2} r={2} fill={W} />
          <VCircle cx={HEAD_W} cy={EYE_Y + 2} r={2} fill={W} />
        </>
      );
    case 'satchel':
      return (
        <>
          <path className="ch-line" fill="none" d={`M -11.5 ${SHOULDER_Y + 2} L 11.5 ${WAIST_Y - 2}`} />
          <VRect x={8} y={WAIST_Y - 4} width={11} height={9} rx={2} fill={W} />
          <VCircle cx={13.5} cy={WAIST_Y + 1} r={1.4} fill={skin} />
        </>
      );
    default:
      return null;
  }
}
