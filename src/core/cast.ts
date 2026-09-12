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
 * │                                                                          │
 * │ ⚠ 12, DOWN FROM 30 ON 07/09, and the ceiling had to come down with the   │
 * │ art. `CHESS_SEAT` is built from this number, so slack here is a player   │
 * │ pushed that far forward of the stool they are supposed to be sitting on. │
 * │ The v4 sit cells need 6 units at worst; 12 is one re-roll of headroom,   │
 * │ not a number chosen to never have to think again.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const MAX_SIT_LIFT = 12;

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

/**
 * 🔴 THE GARMENT PALETTE. → docs/SPEC-office-art.md §11
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ THE SAME TEN ARE ALSO IN `office.css` AS `--cast-1…10`, AND THAT IS A  │
 * │ SECOND COPY. Stated rather than hidden: CSS cannot import a module, and  │
 * │ the CSS copy paints the BOOKS on the shelf, not a person. If the two     │
 * │ ever disagree the only visible symptom is a bookshelf whose colours no   │
 * │ longer echo the cast — a cosmetic drift, and the price of not inventing  │
 * │ a build step to generate one from the other.                             │
 * │                                                                          │
 * │ ⚠ Every one is MID-LIGHTNESS on purpose. `mix-blend-mode: color` keeps   │
 * │ the artwork's luminance and takes only hue and saturation from the tint, │
 * │ so a near-black or near-white entry here would be a colour nobody can    │
 * │ see the difference between. → SPEC-office-art §11                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const GARMENT_TINTS: readonly string[] = [
  '#4a6fa5',
  '#b4532a',
  '#3f7d4a',
  '#8a5a9b',
  '#c08a2e',
  '#2f6f6a',
  '#a8455f',
  '#5c6b3f',
  '#6b5344',
  '#40567e',
];

/** A stored override is honoured only if it is a plain 6-digit hex colour. */
export function isTint(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

/**
 * 🔴 WHO IS ENTITLED TO KEEP THE COLOUR THEIR SHEET WAS DRAWN IN. → §17k′
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SORTING A FACE GROUP BY ID MADE THE ASSISTANT LOSE, EVERY SINGLE TIME.   │
 * │                                                                          │
 * │ Every worker's node id starts `agent:` and the assistant's is            │
 * │ `assistant`; `'g' < 's'`, so a worker always sorted first and the        │
 * │ assistant always came second — which is the one figure in the room whose │
 * │ appearance must never move, and the one the whole room is drawn around.  │
 * │                                                                          │
 * │ The user hit it the obvious way and called it what it is: *"I pick a     │
 * │ character for employee 5, it happens to be the assistant's, and now the  │
 * │ ASSISTANT is not in its own colour any more — that makes no sense."*     │
 * │ Two separate wrongs stacked in that one sentence:                        │
 * │                                                                          │
 * │  ① the assistant was recoloured by somebody else's choice                │
 * │  ② the person who ASKED for the face kept the original, and the person   │
 * │    who was already wearing it was the one put in a costume               │
 * │                                                                          │
 * │ ⚠ ② IS THE GENERAL RULE AND ① IS A SPECIAL CASE OF IT: a change should   │
 * │ land on whoever caused it. A hand pick is the only "who caused it" this  │
 * │ function can observe, because nothing on disk records who arrived first  │
 * │ — see the note at the foot of `assignCast` about hire-time storage.      │
 * │                                                                          │
 * │ ⚠ WHAT THIS DOES NOT FIX, stated so nobody thinks it did: hiring a       │
 * │ worker whose id sorts BEFORE an incumbent on the same face still moves   │
 * │ the incumbent's colour. Only storing at hire time closes that, and that  │
 * │ is a decision about `layout.json`, not about this ordering.              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface TintOrder {
  /**
   * The one id that always keeps its own colour. The CALLER names it — `core`
   * must not decide that the assistant is special, the same way the renderer is
   * told `onTop` rather than being told who this is.
   */
  anchor?: string;
  /** `layout.cast`: faces the user picked BY HAND. A picker yields to everybody else. */
  picked?: Readonly<Record<string, number>>;
}

/** Lower wins the sheet's own colour. Stable sort ⇒ ties keep id order. */
function keeper(id: string, face: number, opts: TintOrder): number {
  if (id === opts.anchor) return 0;
  // ⚠ `% FACE_COUNT`, because `layout.cast` legitimately holds 0…9 while there
  // are five drawings — a pick of 7 IS a pick of face 2, and reading it raw
  // would let the picker quietly keep the original after all.
  const pick = opts.picked?.[id];
  return pick !== undefined && isCastId(pick) && pick % FACE_COUNT === face ? 2 : 1;
}

/**
 * 🔴 WHO GETS A COLOURED GARMENT, AND WHO KEEPS THE ONE THEY WERE DRAWN IN.
 * → docs/SPEC-office-animation.md §17k · §17k″ · SPEC-office-art §11
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FIRST PERSON ON A FACE IS NOT TINTED AT ALL — NOT "TINTED WITH THE   │
 * │ ORIGINAL COLOUR".                                                        │
 * │                                                                          │
 * │ A tint layer at any colour is a masked element with `mix-blend-mode` on   │
 * │ it, and that costs a compositing pass per person on every frame they      │
 * │ move. "Absent" and "transparent" are the same picture and very different  │
 * │ machines. So the map returned here has NO ENTRY for anybody who is the    │
 * │ only holder of their face, and the renderer draws no layer for them.      │
 * │                                                                          │
 * │ 🔴 COMPUTED, NEVER WRITTEN. The only place that knows the whole roster is │
 * │ `canvas()`, and `canvas()` is a READ. A read that writes `layout.json`    │
 * │ and emits `layout.changed` is the feedback loop this repository has       │
 * │ already paid for once — the same reason `assignCast` recomputes rather    │
 * │ than storing. A hand-picked colour IS stored, because that is a decision  │
 * │ a person made, and it arrives here as `stored` and wins outright.         │
 * │                                                                          │
 * │ ⚠ THE COST, STATED: firing somebody can change the colour of whoever      │
 * │ their face-clash had displaced, exactly as it can change their face.      │
 * │ One mechanism, one cost, already accepted.                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * @param faces the result of `assignCast` — id → face index.
 * @param stored `layout.tint`: colours the user picked by hand. Honoured verbatim.
 * @param opts   who is entitled to keep the sheet's own colour. → `TintOrder`
 */
export function assignTints(
  faces: Readonly<Record<string, number>>,
  stored: Readonly<Record<string, string>> = {},
  opts: TintOrder = {},
): Record<string, string> {
  const out: Record<string, string> = {};

  /**
   * ⚠ GROUPED BY FACE, AND ORDERED INSIDE EACH GROUP.
   *
   * Two people in different faces wearing the same colour is fine — they already
   * look nothing alike, and the colour is not an identifier. The only pair that
   * matters is two people on the SAME face, so the basket is per face and there
   * is no global scarcity to manage.
   *
   * The id is the LAST tiebreak, for the reason `assignCast` sorts by it: the
   * answer must not depend on the order `layout.nodes` happened to be dragged
   * into by a browser. It is no longer the FIRST key — see `keeper` below.
   */
  const byFace = new Map<number, string[]>();
  for (const id of Object.keys(faces).sort()) {
    const face = faces[id]!;
    const list = byFace.get(face);
    if (list) list.push(id);
    else byFace.set(face, [id]);
  }
  for (const [face, group] of byFace) {
    group.sort((a, b) => keeper(a, face, opts) - keeper(b, face, opts));
  }

  for (const [, group] of byFace) {
    /**
     * 🔴 DEAL FROM A BASKET, DO NOT TRUST THE HASH. This is the twins bug one
     * layer down, and it was measured in the live room on 07/09 before it was
     * fixed: two of seven tinted people came out `#5c6b3f`.
     *
     * A plain `hash % 10` collides at exactly the rate the birthday problem
     * says — for the three people who can share one face that is ~28 %, and a
     * collision here is two employees who look alike AND wear the same colour,
     * which is precisely the state the colour exists to prevent.
     *
     * ⚠ A HAND-PICKED COLOUR TAKES ITS SEAT FIRST, before any dealing, or the
     * deal hands somebody a colour the user has already claimed — the same rule
     * `assignCast` states for a hand-picked face, and for the same reason.
     */
    const used = new Set<string>();
    for (const id of group) {
      if (!isTint(stored[id])) continue;
      out[id] = stored[id]!.toLowerCase();
      used.add(out[id]!);
    }

    for (const [i, id] of group.entries()) {
      if (out[id] !== undefined) continue;
      /**
       * ⚠ THE HEAD OF THE GROUP GETS NO ENTRY, so the renderer draws no layer
       * for them: they wear the colour they were drawn in, which is the one
       * every sheet was designed around. Who the head IS is `keeper`'s answer,
       * not the id order — → `TintOrder`.
       *
       * ⚠ POSITION IN THE GROUP, not "the first one still without a colour". If
       * the second person has a hand-picked colour and the first does not, the
       * first is still the one who keeps the original — a stored choice must not
       * push somebody else into a costume.
       */
      if (i === 0) continue;
      /**
       * ⚠ HASHED, NOT RANDOM. Random would re-roll on every read and the room
       * would flicker through colours while nothing about the office changed —
       * `canvas()` runs on every SSE event.
       *
       * Seeded with the FACE as well as the id, so the same person moved to a
       * different face gets a different colour: the colour is there to separate
       * two people who look alike, and it should move when that does.
       */
      const want = hash32(`tint:${faces[id]}:${id}`) % GARMENT_TINTS.length;
      let pick = want;
      for (let step = 1; step <= GARMENT_TINTS.length && used.has(GARMENT_TINTS[pick]!); step++) {
        pick = (want + step) % GARMENT_TINTS.length;
      }
      out[id] = GARMENT_TINTS[pick]!;
      used.add(out[id]!);
    }
  }
  return out;
}
