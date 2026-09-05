import c0 from './cast/c0.png';
import c1 from './cast/c1.png';

/**
 * THE ART SLOT. → docs/SPEC-office-animation.md §2c
 *                 docs/SPEC-office-art.md  ← how the pictures are generated
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE DRAWING IS A PLUG-IN, AND THIS FILE IS THE SOCKET.                    │
 * │                                                                          │
 * │ `SPRITES = null` ⇒ the room draws its own characters (`Character.tsx`).    │
 * │ Point it at strips and the same room plays those instead. Nothing else in │
 * │ the office view knows which is running — the loop moves a BOX, and what   │
 * │ is inside the box is one file's business.                                 │
 * │                                                                          │
 * │ That seam is why swapping the art costs one file rather than a rewrite,   │
 * │ and it is deliberately the first thing that was built.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ ONE STRIP PER PERSON, AND THE GEOMETRY IS A CONSTANT, NOT A FIELD.     │
 * │                                                                          │
 * │ Every strip is normalised by `scripts/normalise-cast` before it lands     │
 * │ here: six cells of `CELL`, the figure centred, the FEET on the bottom     │
 * │ edge, and one scale factor shared by all six so a seated person is        │
 * │ shorter rather than resized.                                             │
 * │                                                                          │
 * │ Because that is guaranteed upstream, the renderer needs no per-asset      │
 * │ offsets — and an asset that was not normalised is a bug in the pipeline,  │
 * │ not a special case to carry here forever.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── ⚠ THE LICENCE IS NOT OPTIONAL ─────────────────────────────────────────
 *
 * `licence` and `source` are REQUIRED FIELDS, on purpose. A file whose
 * provenance nobody can state is a file that must not ship. Making the field
 * required means that question is answered at the moment the asset arrives,
 * not during a licence review two years later.
 */

/** One cell of a strip, in the strip's own pixels. */
export const CELL = { w: 220, h: 300 } as const;

/**
 * The figure's own height inside a cell, for the STANDING poses. The renderer
 * scales `CELL.h` so that this lands on `CH_H`, which is why a person comes out
 * the right size next to the furniture whatever the strip was authored at.
 */
export const BODY_H = 258;

/**
 * Frame order inside the strip. ⚠ POSITIONAL — the normaliser writes cells in
 * this order and the CSS steps through `walk` by index, so a reorder here
 * without a reorder there animates somebody's arm into their head.
 */
export const FRAMES = {
  stand: 0,
  walk: [1, 2, 3, 4],
  sit: 5,
} as const;

export interface CastSprite {
  /** The strip, imported as a URL. */
  src: string;
  /** REQUIRED. e.g. "Generated in-house, no third-party asset". */
  licence: string;
  /** REQUIRED. Where it came from, so the claim above can be checked. */
  source: string;
}

/**
 * ⚠ `null` MEANS THE BUILT-IN DRAWING. Setting this to a list switches the whole
 * room over; setting it back to `null` switches back. Nothing is deleted either
 * way, which is the entire point of the socket.
 *
 * ⚠ INDEXED BY `CastMember.id`. Shorter than `CAST` ⇒ it wraps, so a
 * ten-strong office can run on two strips while the rest are being drawn.
 */
export const SPRITES: readonly CastSprite[] | null = [
  {
    src: c0,
    licence: 'Generated in-house — no third-party asset, no licence to comply with',
    source: 'Google AI Studio, prompt in docs/SPEC-office-art.md §2',
  },
  {
    src: c1,
    licence: 'Generated in-house — no third-party asset, no licence to comply with',
    source: 'Google AI Studio, prompt in docs/SPEC-office-art.md §2',
  },
];
