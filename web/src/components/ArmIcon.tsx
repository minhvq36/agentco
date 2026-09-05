/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE ARM = ONE MARK, AND THE SAME MARK EVERYWHERE. (settled 27–28/08)     │
 * │                                                                          │
 * │ > *"a card should have a distinguishing icon in front … carried all the  │
 * │ >  way through the inner tiers too"* · *"and the mcp server node on the  │
 * │ >  canvas: change the plug symbol to … match each kind of mcp"*          │
 * │                                                                          │
 * │ Drawn in FIVE places: the kind picker · the services grid · the reuse    │
 * │ list · the step-2 heading · THE NODE ON THE DIAGRAM. Five copies of one  │
 * │ mapping are five places to drift, and drifting loses exactly what the    │
 * │ mark exists for: recognising THAT IT IS STILL THE SAME THING when moving │
 * │ from one screen to another.                                              │
 * │                                                                          │
 * │ 🔴 NO VENDOR NAME APPEARS IN THIS FILE, and that is the 28/08 change.    │
 * │ The first version had `{ github: '<path…>', notion: '<path…>' }` right   │
 * │ here — meaning a vendor's logo lived in the web folder while the brand   │
 * │ declaration (`brand.checkedOn`, rule §11c *"guidelines unread ⇒ no       │
 * │ logo"*) lived in the catalogue. Two files, nobody reconciling them ⇒ we  │
 * │ shipped a logo while the declaration still said *"guidelines unread"*,   │
 * │ and NOTHING COMPLAINED.                                                  │
 * │ ⇒ The path now travels with the brand record itself: `catalog.ts         │
 * │ §brand.mark`.                                                            │
 * │                                                                          │
 * │ ⚠ MONOCHROME — `currentColor` throughout, vendor logos included. The old │
 * │ emoji (📁 🔌 ⚙️ 📝) carried the OS font's own colours: one card rendered │
 * │ three different ways on three machines, and none of them followed our    │
 * │ light/dark ground.                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Cog, Folder, Globe, Plug, SquareTerminal } from 'lucide-react';

/** The arm kinds. Same axis as `ArmDialog §kindOf` and `office.ts §armKind`. */
export type ArmKind = 'files' | 'service' | 'custom' | 'browser' | 'cli';

/**
 * An arm's mark.
 *
 * `mark` = the vendor's 24×24 SVG path, coming from the catalogue. Absent ⇒ fall
 * back to a mark by KIND, which is still enough to tell them apart by eye.
 *
 * ⚠ `x` / `y` / `size` are only for drawing INSIDE ANOTHER `<svg>` (the diagram).
 * In ordinary HTML leave them out and position with `className` like any other
 * icon — two ways into one function, because the two drawing sites have two
 * coordinate systems.
 */
export function ArmIcon({
  mark,
  kind,
  className = 'h-3.5 w-3.5',
  x,
  y,
  size,
}: {
  mark?: string;
  kind: ArmKind;
  className?: string;
  x?: number;
  y?: number;
  size?: number;
}) {
  // Inside an SVG, position has to be said in attributes, not classes: a node on
  // the diagram lives in its own coordinate system and Tailwind cannot reach it.
  const place = size !== undefined ? { x, y, width: size, height: size } : {};

  if (mark) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
        className={size === undefined ? className : undefined}
        {...place}
      >
        <path d={mark} />
      </svg>
    );
  }
  // Folder ⇒ folder; self-plugged ⇒ cog; a service with no logo ⇒ plug.
  /**
   * `browser` draws a GLOBE, not a plug. A plug says *this is a connection* —
   * true, and useless when EVERY entry is a connection. The mark has to say what
   * this entry DOES, exactly as the folder does for `files`.
   */
  const Fallback =
    kind === 'files'
      ? Folder
      : kind === 'browser'
        ? Globe
        : // Command line: a `>_` mark. Someone who does not write code has never
          // heard of `argv`, but they have seen that prompt in every film with a
          // computer in it.
          kind === 'cli'
          ? SquareTerminal
          : kind === 'custom'
            ? Cog
            : Plug;
  return (
    <Fallback
      aria-hidden="true"
      className={size === undefined ? className : undefined}
      {...place}
    />
  );
}
