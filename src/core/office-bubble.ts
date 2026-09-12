/**
 * WHAT FITS IN A SPEECH BUBBLE. → docs/SPEC-office-art.md §12
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 A BUBBLE IS A SIGNAL THAT SOMEBODY IS TALKING. IT IS NOT A PLACE TO    │
 * │ READ.                                                                     │
 * │                                                                           │
 * │ Measured on a real turn: a `git status` summary came back as eighteen     │
 * │ LINES of `say`, and the bubble grew into a white slab covering the        │
 * │ window, the whiteboard, the clock and half the floor. The room stopped    │
 * │ being a room.                                                             │
 * │                                                                           │
 * │ Wrapping is not the answer and neither is a scrollbar. The chat panel is  │
 * │ already the surface for reading — one click away, always in sync, and     │
 * │ scrollable. The bubble's whole job is *this person is saying something*,  │
 * │ and that survives eighteen characters.                                    │
 * │                                                                           │
 * │ ⚠ NOTHING IS LOST BY CLIPPING. The full sentence stays on the actor       │
 * │ button's accessible name and in the chat; only the picture is shortened.  │
 * │ Clipping in the STORE instead would have taken the sentence away from     │
 * │ the one reader who cannot see the picture at all.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE — no `node:*`, no disk, no `process`. Imported by the interface through
 * `@core`, the same way `office-floor.ts` is, and for the same recorded reason:
 * a rule worth stating is a rule a test has to be able to reach.
 */

/**
 * 🔴 THE ELLIPSIS IS INSIDE THE BUDGET, AND IT IS ONE CHARACTER.
 *
 * A cap that appends a marker to its limit is not a cap — it is the limit plus
 * whatever the marker happens to cost, and nobody notices until somebody writes
 * `...` and it becomes three.
 */
export const BUBBLE_MAX = 18;

/**
 * The bubble's text, at most `BUBBLE_MAX` characters including the ellipsis.
 *
 * ⚠ COUNTED IN CODE POINTS, NOT CODE UNITS. Vietnamese in NFD carries combining
 * marks and an emoji glyph is a surrogate pair; `String.slice` cuts between a
 * letter and its tone, which renders as a lone accent floating on nothing.
 *
 * ⚠ Whitespace is collapsed FIRST, and that is not tidiness. `say` arrives with
 * newlines in it — the slab above was eighteen lines — so a cap applied before
 * the collapse would keep eighteen characters of a paragraph and still draw a
 * box four lines tall.
 */
export function clipBubble(text: string): string {
  const chars = Array.from(text.replace(/\s+/gu, ' ').trim());
  if (chars.length <= BUBBLE_MAX) return chars.join('');
  return `${chars.slice(0, BUBBLE_MAX - 1).join('').trimEnd()}…`;
}
