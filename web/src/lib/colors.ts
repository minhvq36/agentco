/**
 * An agent's colour. → docs/SPEC-offices.md §6
 *
 * HASHED from the id rather than stored — a copy of `agentHue` in
 * `src/core/plans.ts`. Adding or removing a person never shifts anyone else's
 * colour, and it does not create one more config file to drift.
 *
 * The backend also sends `hue` down with the canvas; this function is for the
 * log, where we have a role id and no node.
 */
export function agentHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const raw = Math.abs(h) % 335;
  // Skip the 45–70° band: yellow on a light paper ground is unreadable.
  return raw < 45 ? raw : raw + 25;
}

/**
 * Ink and chip-background colours.
 *
 * `light-dark()` rather than a fixed value: a colour with enough contrast on
 * light paper sinks into a dark ground, and the reverse. It needs
 * `color-scheme: light dark` on `:root` to work at all — set in index.css.
 */
export function agentInk(hue: number): string {
  return `light-dark(oklch(0.5 0.15 ${hue}), oklch(0.78 0.12 ${hue}))`;
}

export function agentWash(hue: number): string {
  return `light-dark(oklch(0.62 0.15 ${hue} / 0.13), oklch(0.72 0.14 ${hue} / 0.16))`;
}
