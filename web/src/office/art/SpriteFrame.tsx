import { CELL, scaleFor, spriteFor } from './manifest';

/**
 * ONE FRAME of one character's strip, at a given height. → `manifest.ts`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS EXISTS AT ALL: three surfaces draw a person and they must not    │
 * │ disagree — the room, the picker, and the contact sheet. When the room     │
 * │ drew people with `<Character>` and the picker drew its swatches with the  │
 * │ same component, that was free. With a strip it is not free: the cell      │
 * │ maths (`background-size`, `background-position`) has to be written        │
 * │ somewhere, and written twice it drifts.                                   │
 * │                                                                          │
 * │ ⚠ The ROOM does NOT use this. It needs the walk animation, which lives in │
 * │ CSS on `.sprite-art`, and it must not re-render per frame. This is for    │
 * │ the STILL surfaces only.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function SpriteFrame({
  cast,
  frame,
  height,
  className = '',
}: {
  cast: number;
  /** Index into the strip. `FRAMES` in `manifest.ts` names them. */
  frame: number;
  /** Rendered height of the whole CELL, in px. The figure inside is `BODY_H/CELL.h` of it. */
  height: number;
  className?: string;
}) {
  /**
   * ⚠ The per-sheet scale applies HERE TOO, or the picker previews somebody at a
   * size the room does not draw them at — which is the whole failure this
   * component exists to prevent. `height` is the base cell height; a character
   * authored larger comes out larger, in the swatch as on the floor.
   */
  const h = height * scaleFor(cast);
  const k = h / CELL.h;
  const w = CELL.w * k;
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'block',
        width: `${w}px`,
        height: `${h}px`,
        backgroundImage: `url(${spriteFor(cast).src})`,
        backgroundRepeat: 'no-repeat',
        // The strip is six cells wide; one cell is shown by sliding it left.
        backgroundSize: `${w * 6}px ${h}px`,
        backgroundPosition: `${-w * frame}px 0`,
      }}
    />
  );
}
