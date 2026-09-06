/**
 * THE CAST — ten characters, as a table of parameters.
 * → docs/SPEC-office-animation.md §4 · §2b
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A CHARACTER IS A ROW, NOT A DRAWING.                                     │
 * │                                                                          │
 * │ There is exactly ONE drawing (`web/src/office/Character.tsx`) reading     │
 * │ these rows. Ten characters therefore CANNOT drift apart, because there    │
 * │ are not ten drawings — there is one drawing and ten configurations.       │
 * │ Drift is a disease of independent assets, and this design owns none.      │
 * │                                                                          │
 * │ Adding an eleventh character is ONE ROW here. No asset, no export, no     │
 * │ licence, no sprite sheet, nothing to hold in texture memory.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE COPYRIGHT FENCE, AND IT IS CHECKABLE.                             │
 * │                                                                          │
 * │ A specific character (its design, its name, its colour scheme) is         │
 * │ protected by copyright AND trademark. A genre convention — a small        │
 * │ standing figure, an oversized head, flat cel colours, a cap, a lab coat,  │
 * │ a ponytail — is protected by nothing, and nobody owns it.                 │
 * │                                                                          │
 * │ So the rule is: **no member may carry a NAME + a SILHOUETTE + a COLOUR    │
 * │ SCHEME that together point at one existing character.** Individually      │
 * │ generic parts are fine and unavoidable — a cap is a cap. It is the        │
 * │ identifying COMBINATION that is forbidden. These ten are built from       │
 * │ office archetypes rather than from anyone's roster, precisely so this      │
 * │ never has to be argued at review time.                                    │
 * │                                                                          │
 * │ ⚠ Members deliberately have NO NAMES. The name above a character's head   │
 * │ is the EMPLOYEE's name — the one the user typed. A cast with names of      │
 * │ its own would need a catalogue entry per language, and would manufacture   │
 * │ exactly the identity this fence exists to avoid.                          │
 * │                                                                          │
 * │ ⚠ And zero third-party assets, ever. Every path is written in this repo,   │
 * │ so there is no licence to comply with and no provenance we cannot          │
 * │ answer for. Many "free" packs in this style are themselves derivative —   │
 * │ the uploader had no right to grant.                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE — no `node:*`, no disk, no `process`. The interface imports it through
 * the `@core` alias, the same way it imports `layout-geometry.ts`, and for the
 * same recorded reason: two copies of one table drift, and the day they drift
 * the server would validate a character the interface cannot draw.
 */

export type HairId = 'short' | 'bob' | 'ponytail' | 'bun' | 'long' | 'buzz' | 'curly' | 'braids';
export type HeadwearId = 'none' | 'cap' | 'beanie' | 'headband' | 'glassesUp';
export type AccessoryId = 'none' | 'glasses' | 'scarf' | 'badge' | 'earbuds' | 'satchel';

export interface CastMember {
  /** 0..9. STABLE FOREVER — this number is what gets persisted in `layout.json`. */
  id: number;
  hair: HairId;
  headwear: HeadwearId;
  accessory: AccessoryId;
  /** Index into the `--cast-N` garment token array, 1-based. */
  garment: number;
  /** Index into the `--skin-N` token array, 1-based. */
  skin: number;
}

/**
 * ⚠ ORDER AND `id` ARE PART OF THE STORED DATA. Reordering this array renames
 * everyone in every office that ever picked a character by hand. Append only.
 */
export const CAST: readonly CastMember[] = [
  { id: 0, hair: 'short', headwear: 'none', accessory: 'glasses', garment: 1, skin: 2 },
  { id: 1, hair: 'ponytail', headwear: 'none', accessory: 'badge', garment: 2, skin: 1 },
  { id: 2, hair: 'buzz', headwear: 'cap', accessory: 'none', garment: 3, skin: 4 },
  { id: 3, hair: 'bob', headwear: 'none', accessory: 'scarf', garment: 4, skin: 3 },
  { id: 4, hair: 'curly', headwear: 'none', accessory: 'earbuds', garment: 5, skin: 5 },
  { id: 5, hair: 'bun', headwear: 'glassesUp', accessory: 'none', garment: 6, skin: 2 },
  { id: 6, hair: 'long', headwear: 'headband', accessory: 'none', garment: 7, skin: 1 },
  { id: 7, hair: 'braids', headwear: 'none', accessory: 'satchel', garment: 8, skin: 4 },
  { id: 8, hair: 'short', headwear: 'beanie', accessory: 'none', garment: 9, skin: 3 },
  { id: 9, hair: 'curly', headwear: 'none', accessory: 'glasses', garment: 10, skin: 5 },
];

export const CAST_COUNT = CAST.length;

/**
 * Who a node looks like, when nobody has chosen.
 *
 * HASHED rather than stored — the same reasoning as `agentHue`, and it buys the
 * same two things: a brand-new office already has a full cast with zero stored
 * state, and hiring or firing somebody never shifts anybody else's face.
 *
 * Seeded with the office id as well as the node id so two offices do not line up
 * character-for-character. Collisions WITHIN one office are possible and are
 * fine: two people can wear the same shirt, and the name over each head is what
 * identifies them.
 *
 * FNV-1a, the same hash `agentHue` uses. One hash in the codebase, not two.
 */
export function castOf(officeId: string, nodeId: string): number {
  return hash32(`${officeId}:${nodeId}`) % CAST_COUNT;
}

/**
 * FNV-1a, 32-bit. The ONE hash in this codebase for "give me a stable number
 * from a string" — `agentHue` uses the same constants, and the office view's
 * seeded jitter uses this function itself rather than a fourth copy.
 *
 * Always non-negative, so a caller can `%` it without thinking about it.
 */
export function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** A stored override is only honoured if it names a character that exists. */
export function isCastId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CAST_COUNT;
}

/**
 * 🔴 HOW MANY DISTINCT PEOPLE THE ROOM CAN ACTUALLY DRAW. → SPEC-office-art.md §9
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS NOT `CAST_COUNT`, AND THE GAP IS WHERE THE TWINS CAME FROM.       │
 * │                                                                           │
 * │ `CAST` is TEN rows and there are FIVE sprite strips. `spriteFor()` wraps  │
 * │ (`cast % 5`), so character 2 and character 7 are the SAME DRAWING. Two    │
 * │ employees could be dealt different, correct, in-range, distinct cast ids  │
 * │ and still stand in the room as identical twins — and every check there    │
 * │ was said they were different people.                                      │
 * │                                                                           │
 * │ ⚠ So "have we run out of characters" is a question about DRAWINGS, and    │
 * │ the number lives here, in the file both sides read. `art/manifest.ts`     │
 * │ throws at load if its strip count disagrees — a wire that is checked at   │
 * │ boot rather than described in a comment.                                  │
 * │                                                                           │
 * │ ⚠ The ten rows stay. They are STORED DATA (`layout.cast` holds 0…9) and   │
 * │ the table is append-only; deleting five rows would silently re-cast       │
 * │ everybody a user hand-picked above 4.                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const FACE_COUNT = 5;

/**
 * 🔴 THE MOST A SEATED SPRITE MAY BE RAISED OFF ITS ANCHOR, IN WORLD UNITS.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A CEILING, NOT A MEASUREMENT — and it is here so a rule in `core` can    │
 * │ depend on it.                                                            │
 * │                                                                          │
 * │ `art/manifest.ts §sitLift` raises the seated cell of a short sheet so    │
 * │ every seated figure stands off its seat by the same amount. That moves   │
 * │ the DRAWING without moving the anchor, so anything positioned against a  │
 * │ seated person's feet has to allow for it — `CHESS_SEAT` does, and it     │
 * │ cannot see the manifest.                                                 │
 * │                                                                          │
 * │ ⚠ The manifest THROWS at load if any sheet exceeds this. Re-cut a strip  │
 * │ with a shorter `sit` cell and the app fails loudly on the line that      │
 * │ loads the room, rather than seating somebody on the chess pieces six     │
 * │ weeks later. Raising it is a decision about the floor plan, not a nudge. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const MAX_SIT_LIFT = 30;

/**
 * 🔴 WHO LOOKS LIKE WHOM, WITH NO TWO ALIKE WHILE ANY FACE IS STILL FREE.
 * → docs/SPEC-office-art.md §9
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A PURE HASH WAS ALWAYS GOING TO COLLIDE, AND THE MATHS SAYS HOW OFTEN.    │
 * │                                                                           │
 * │ Five faces, five employees: `5! / 5⁵` = **3.8 %** chance that all five    │
 * │ come out different. Collisions were never a risk — they were the default, │
 * │ and the room showed the user two identical people in an office with       │
 * │ three faces still unused.                                                 │
 * │                                                                           │
 * │ ⇒ Deal from the basket. Each person's HASH is still their preference, so  │
 * │ an office where nothing collides is dealt exactly what the hash always    │
 * │ gave it; a clash probes forward to the next free face. When the basket    │
 * │ empties it refills, so the eleventh employee starts a fresh round instead │
 * │ of piling onto whoever is left.                                           │
 * │                                                                           │
 * │ ⚠ COUNTS EVERY PERSON ON THE DIAGRAM, RESTING OR NOT. Somebody at the     │
 * │ coffee counter is a face on screen; leaving them out of the count is how  │
 * │ two people end up in the same shirt while a face nobody is using sits in  │
 * │ the basket.                                                               │
 * │                                                                           │
 * │ ⚠ A HAND-PICKED FACE IS A DECISION AND TAKES ITS SEAT FIRST — before any  │
 * │ dealing — or the deal would hand somebody a face the user has already     │
 * │ claimed, and the twin comes back through the one door the user controls.  │
 * │                                                                           │
 * │ 🔴 THE COST, STATED RATHER THAN DISCOVERED: this is NOT assign-once. It   │
 * │ recomputes on every read, so firing somebody can change the face of the   │
 * │ one person their clash had displaced. The hash bought *"hiring or firing  │
 * │ never shifts anybody"* and that is genuinely gone. Storing at HIRE time   │
 * │ would keep it (§9 Rule A) — but the only place that knows the full roster │
 * │ is `canvas()`, which is a READ, and a read that writes and emits          │
 * │ `layout.changed` is the feedback loop this repository has already paid    │
 * │ for once. A stable face is not worth a silent write on every poll.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * @param people every node that gets drawn as a person — the assistant included.
 * @param stored `layout.cast`: faces the user picked by hand. Honoured verbatim.
 */
export function assignCast(
  officeId: string,
  people: Iterable<string>,
  stored: Readonly<Record<string, number>> = {},
): Record<string, number> {
  /**
   * ⚠ SORTED, so the answer cannot depend on the order the caller happened to
   * hold its nodes in. `layout.nodes` is rewritten wholesale by the browser on
   * every canvas drag, so its order is not something to build a rule on.
   */
  const ids = [...people].sort();
  const out: Record<string, number> = {};
  const used = new Set<number>();

  for (const id of ids) {
    const pick = stored[id];
    if (pick === undefined || !isCastId(pick)) continue;
    out[id] = pick;
    used.add(pick % FACE_COUNT);
  }

  for (const id of ids) {
    if (out[id] !== undefined) continue;
    // Basket empty ⇒ refill. Checked BEFORE the probe, so the probe below is
    // always guaranteed a free face and can never fall through to a duplicate.
    if (used.size >= FACE_COUNT) used.clear();
    const want = castOf(officeId, id) % FACE_COUNT;
    let face = want;
    for (let step = 1; step <= FACE_COUNT && used.has(face); step++) {
      face = (want + step) % FACE_COUNT;
    }
    used.add(face);
    out[id] = face;
  }
  return out;
}
