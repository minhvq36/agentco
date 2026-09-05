# SPEC — Office art: how the pictures are made

Sibling of `SPEC-office-animation.md`. That file owns the **loop** (who moves where,
and why). This one owns the **pictures** the loop moves around, and the prompts
that generate them.

The seam between the two is `web/src/office/scene.ts` (the renderer port) and
`web/src/office/art/manifest.ts` (the art slot). Nothing in this document may
require a change above that seam.

---

## 0. The two rules that everything else follows from

> ### ⚠ REVIEW AT THE SHIPPING SIZE, AND AT MAX ZOOM. NOT IN BETWEEN.
>
> A character renders about **133 px tall** in the room and up to **~330 px** at the
> `2.5×` zoom ceiling. Those are the only two sizes a defect matters at.
>
> This was learned by getting it wrong: a masking flaw was called a failure after
> being inspected at an arbitrary test size, and at 133 px it turned out to be
> **invisible** — while a different flaw only appeared once zoomed. Judging at a
> size nobody ever sees produces both false alarms and misses.
>
> Every review screenshot in this document is therefore taken **twice**.


### 🔴 Rule 1 — THE FACE IS VISIBLE IN EVERY FRAME

The front view is the one that was approved, and the reason is legible: you see the
whole face. A 90° profile loses an eye and loses the charm with it.

So: `stand` and `sit` are **front**; the walk frames are **three-quarter** (body
turned ~30°, face still toward the viewer). Never a full profile.

This also removes a whole class of staging problem. Two people at the same station
in profile face *each other* — that reads as a confrontation. Two people front-on
reads as colleagues.

### 🔴 Rule 2 — THE ROOM IS NOT ONE PICTURE. IT IS A SET OF PIECES.

It is tempting to generate the whole office as a single image and paint it behind
the actors. **That breaks three things at once**, and all three are already built:

1. **Hit-testing.** `Station` in `Room.tsx` is a real focusable button with an
   accessible name — a station that opens a panel and cannot be tabbed to is a door
   only a mouse can use. A flat image has no doors.
2. **Occlusion.** A person walks *behind* the bookshelf and *in front of* the filing
   desk. One flat layer can only be all-behind or all-in-front.
3. **Coordinates.** `ringSlots()` derives standing positions from the `STATIONS`
   rectangles in `core/office-floor.ts`. Those numbers are the authority; a picture
   that disagrees with them puts people inside furniture.

⇒ **Generate each piece separately**, place it by code at coordinates that already
exist, and sort it into the same painter's order as the actors.

> This is the answer to *"do we have to convert the room to SVG for overlay?"*
> **No — you have to keep it in PIECES.** Separate PNGs plus coordinates in code
> give overlay for free; a single SVG of the whole room would have exactly the same
> three problems as a single PNG.

---

## 1. Frame and anchor — shared by characters and furniture

Every generated cell is **200 × 275 px**, PNG with real alpha.

| Guide | Position | Rule |
|---|---|---|
| 🔴 **Floor** | y = 275 (bottom edge) | The subject's **base touches the bottom**. No bottom margin — the app's origin is the feet / the footprint. |
| 🔵 **Centre axis** | x = 100 | Subject centred horizontally. |
| 🟢 **Top** | y ≈ 14 (5%) | Same height across `stand` and all walk frames; lower for `sit`. |

Keep a **6% margin** left and right. Nothing touches the side edges.

Scale reference: a person is **`CH_H = 133`** world units tall in a `1600 × 900`
world, at roughly **5 heads**. Furniture is sized against that person, not by eye.

`anchor-template.png` (scratch) renders these guides for pasting alongside a prompt.

---

## 2. Character sheet

**One file per character. Not six files.**

```
char-01.png    1200 × 275 px, transparent

┌────────┬────────┬────────┬────────┬────────┬────────┐
│ stand  │ walk1  │ walk2  │ walk3  │ walk4  │  sit   │
└────────┴────────┴────────┴────────┴────────┴────────┘
   each cell exactly 200 × 275
```

| Cell | Content |
|---|---|
| `stand` | Front view, at rest, arms down |
| `walk1` | ¾ · **contact** — right foot planted forward, left leg extended back, LEFT arm forward |
| `walk2` | ¾ · **passing** — legs close, left leg passing the right, body at its highest |
| `walk3` | ¾ · **contact reversed** — LEFT foot forward, right leg back, RIGHT arm forward |
| `walk4` | ¾ · **passing reversed** |
| `sit` | Front view, knees toward viewer, body lowered. **No chair.** |

### 🔴 `walk1` and `walk3` must have OPPOSITE legs forward — FAILED 5/5

Measured on all five delivered characters: **every one has the same leg leading in
both contact frames.** Only the stride width changes. Alternating them is not a walk,
it is **trembling in place**.

The instruction *"pose 4 has the opposite leg forward"* was in the prompt and was
ignored five times out of five. Stating the requirement is not enough — the model
collapses both contacts into one generic walking pose. It has to be told **how to
construct** the second one:

```
These four frames are ONE walk cycle and MUST differ from each other:
  Frame 1 - CONTACT: RIGHT leg forward, LEFT arm forward
  Frame 2 - PASSING: legs together, body at its highest
  Frame 3 - CONTACT: LEFT leg forward, RIGHT arm forward  <-- OPPOSITE of frame 1
  Frame 4 - PASSING: legs together, body at its highest

Build frame 3 by taking frame 1 and SWAPPING which leg is in front and which
arm is in front, while keeping the body facing the same direction. Do not
mirror the image - mirroring would turn the character around.

Frame 3 is NOT a copy of frame 1. If the same foot leads in both frame 1 and
frame 3, the animation does not work and frame 3 must be redrawn.
```

⚠ Mirroring is explicitly ruled out **inside the prompt**, because it is the shortcut
a model reaches for and it produces a character walking the other way.

Only the four walk cells need regenerating — `stand` and `sit` are correct on all
five characters.

### ⚠ Mirroring changes DIRECTION, not PHASE

Mirroring `walk1` gives someone walking *left* with **the same leg still forward**.
Facing is already handled in code (`scaleX(-1)` in `DomScene`). The phase must be
drawn.

### ⚠ Why one sheet and not six files

Generated separately, hair volume, hem, shoulder width and skin tone drift by a few
pixels between runs. At ~155 ms per frame that drift reads as **judder**. In one
image the model sees all six at once and holds the person still.

Two or three characters per sheet is better still — consistency has two layers
(*within* a person, and *across the cast*) and a shared sheet addresses both.
Resolution is the limit; do not exceed 3.

### Prompt

```
Generate a 2D game character sprite sheet, flat vector cartoon style.

CANVAS: one single image, 1200x275 pixels, fully TRANSPARENT background,
six poses side by side, each pose occupying exactly 200x275 pixels.
Output ONE image, not six separate images.

POSES, left to right:
1. STAND  - front view, standing at rest, arms relaxed at sides
2. WALK A - three-quarter view, CONTACT: right foot planted forward,
            left leg extended back, LEFT arm swung forward
3. WALK B - three-quarter view, PASSING: legs close together, left leg
            passing the right, body at its HIGHEST point
4. WALK C - three-quarter view, CONTACT REVERSED: left foot planted forward,
            right leg extended back, RIGHT arm swung forward
5. WALK D - three-quarter view, PASSING reversed: legs close together,
            right leg passing the left, body at its highest point
6. SIT    - front view, seated, knees toward the viewer, body lowered.
            NO CHAIR - draw the person only.

CRITICAL - the walk must actually cycle:
Poses 2 and 4 must have OPPOSITE legs forward. If both show the same leg
forward the animation reads as trembling in place, not walking.

CRITICAL - the face must stay visible in every pose:
Poses 2-5 are THREE-QUARTER view (body turned about 30 degrees to the right,
face still turned toward the viewer). NOT a 90-degree side profile.

ALIGNMENT (all six must match exactly):
- The character's FEET touch the very BOTTOM edge of each 200x275 cell.
- The body is horizontally CENTERED in its cell.
- Top of the head is at the same height in poses 1-5; lower in pose 6.
- Keep a 6% margin on left and right; nothing may touch the side edges.

CHARACTER: an adult office worker, warm and friendly, roughly 5 heads tall,
wearing smart-casual office clothing (shirt or polo, trousers or skirt).
The SAME person in all six poses - identical hair, clothing, proportions
and skin tone.

STYLE: flat solid colours only. No gradients, no texture, no soft shading,
no drop shadow, no ground shadow, no background, no text, no logos.
No outline; shapes are defined by flat colour alone.

PALETTE: skin #f0d2b8, hair #3a3128, shoes #2f2a22, garment one of:
#4a6fa5 #b4532a #3f7d4a #8a5a9b #c08a2e #2f6f6a #a8455f #5c6b3f #6b5344 #40567e
```

> Swap the `No outline...` line for
> `Include a dark brown outline (#2b2620) around every shape.`
> if the room keeps its contour line. See §4.

---

## 3. Furniture sheet

Same frame, same anchor, **one cell per object** — never a whole room in one cell.

| Cell | Notes |
|---|---|
| `desk` | Work desk, seen slightly from the front-above |
| `chair` | Office swivel chair, front view — the seat for `sit` |
| `shelf` | Bookcase, against the back wall |
| `sofa` | **Seats two.** Replaces the games console at the break area. |
| `lowtable` | Coffee table, cups on it |
| `foosball` | Table football |
| `chesstable` | Chess table |
| `plant` | Potted plant |
| `cabinet` | Filing cabinet |

### Anchor for furniture

The **footprint** touches the bottom edge — the point where the object meets the
floor, the same convention as the feet. An object that floats above the bottom edge
will float above the floor.

### Occlusion split

Anything a person can walk **behind** and also stand **in front of** must be split
into two cells, drawn either side of the actor layer:

```
desk-back    the part that is behind a seated person
desk-front   the desk top and legs that occlude their shins
```

Only split what needs it — `shelf` and `cabinet` sit against the wall and are always
behind; `plant` is always in front or always behind depending on its y.

### Prompt

```
Generate a 2D game furniture sprite sheet, flat vector cartoon style,
matching a set of office-worker characters drawn in the same style.

CANVAS: one single image, 1800x275 pixels, fully TRANSPARENT background,
nine objects side by side, each occupying exactly 200x275 pixels.
Output ONE image, not nine separate images.

OBJECTS, left to right:
1. DESK        - a simple work desk
2. CHAIR       - an office swivel chair, front view
3. SHELF       - a bookcase with a few books
4. SOFA        - a two-seat sofa
5. LOW TABLE   - a small coffee table with two cups
6. FOOSBALL    - a table football table
7. CHESS TABLE - a small square table with a chessboard on top
8. PLANT       - a potted plant
9. CABINET     - a filing cabinet

ALIGNMENT (all nine must match):
- The base of each object - where it meets the floor - touches the very
  BOTTOM edge of its 200x275 cell.
- Each object is horizontally CENTERED in its cell.
- Keep a 6% margin on left and right.

SCALE: these share a room with adult characters who are about 210 px tall
in this same 275 px cell height. A desk reaches roughly their hip; a
bookcase is about their height; a chair seat is at knee height.

STYLE: flat solid colours only. No gradients, no texture, no soft shading,
no drop shadow, no ground shadow, no background, no text, no logos,
no people. Slight front-above viewing angle, consistent across all nine.
No outline; shapes are defined by flat colour alone.

PALETTE: floor #fbfaf8, wall #f4f1eb, furniture body #ffffff to #e7e3dc,
warm accent #b4532a, wood #6b5344, dark parts #2f2a22
```

---

## 4. The outline decision — one choice, two consequences

Measured, not argued: outlines were stripped from the live room and screenshotted.

- **Characters look better without an outline.** ✅
- **The furniture disappears.** ❌ Desks, shelves and the window are painted white on
  a cream floor; the contour stroke was the only thing defining them.

⇒ "No outline" is not *delete the strokes*. It is **repaint the room.**

| | Characters | Room | Who does the aesthetic work |
|---|---|---|---|
| **(A) outlined** | matches today | unchanged | nobody — it just plugs in |
| **(B) no outline** | better | must be repainted | Claude ⚠ |
| **(D) no outline + generate the furniture too** | better | generated | **the author** ✅ |

**(D)** is the recommended route, and §3 exists to serve it: the room matches the
people *by construction* rather than by patching.

---

## 5. Break area layout

Capacity, and the pose each seat needs — all four are already covered by the
character sheet, so no extra cells are required:

| Station | Capacity | Pose |
|---|---|---|
| Sofa | 2 seated | `sit` |
| Foosball | 2 standing | `stand` |
| Coffee / low table | 1–2 standing | `stand` |
| Chess table | 1 seated | `sit` |

**7 seats.** With a cast of 10, at most 3 can overflow.

### ⚠ Overflow must not vanish

`Room.tsx` opens with a guarantee: *"THE ROOM IS NEVER EMPTY … there is deliberately
NO empty-state screen replacing the room."* Hiding a resting employee is the same
failure through a different door: they exist, they are resting, and **nothing on
screen says they are there**. Absence looks identical to non-existence.

Ranked:

1. **Overflow loiters** — no seat, so they stand around the break area. This is what
   `breakSpot()` already does. Nobody disappears, nothing to write.
2. **Hidden with a count** — a "+3 resting" badge on the break area. Compact without
   being silent.
3. **Hidden outright** — cheapest visually, but a silent disappearance, and it
   contradicts the rule quoted above. If this is chosen, **that rule must be edited
   to match** — a rule that misdescribes what it governs is worse than no rule.

### ⚠ Seats are not wired yet

`breakSpot(seed, step)` returns a **seeded random point inside the break rectangle**.
`breakGame(seed)` picks which of four games somebody plays but does **not** decide
where they stand. Binding a person to a specific sofa cushion or to one end of the
foosball table is **new work**: a table of seat coordinates plus `nearestFreeSlot`,
exactly as the stations already do.

---

## 6. Delivery checklist

- [ ] **One file**, 1200×275 (characters) or 1800×275 (furniture) — not N files
- [ ] Real transparency (place it on black; it must still read as cut out)
- [ ] Cells in the stated order, left to right
- [ ] 🔴 `walk1` and `walk3` have **opposite** legs forward
- [ ] 🔴 Face visible in all six cells — ¾, never a 90° profile
- [ ] 🔴 `sit` has **no chair**
- [ ] Base touches the bottom edge in every cell
- [ ] No baked ground shadow — the room draws its own

On delivery the first step is **measurement, not integration**: cell height, body
height, horizontal centre, base line, skin tone, and a `walk1` vs `walk3` difference
check. Numbers get reported before any code is written — if the drift is large,
regenerating is cheaper than patching.

---

## 7. 🔴 The ground shadow is CODE, and it is not decoration

The generated art must not bake a shadow, and the reason is not taste. In
`office.css` the ellipse under each person is **a status light and a focus ring**:

```css
.actor.is-done  .ch-shadow { fill: var(--color-ok); }
.actor.is-error .ch-shadow { fill: var(--color-danger); }
.actor-art:focus-visible .ch-shadow { fill: var(--color-accent); }
```

A finished task flashes green under somebody's feet; a failure stays red; keyboard
focus lights up the same shape. **A shadow painted into a PNG can do none of those**
— and a second, baked shadow under the real one reads as two light sources.

It also has to scale with depth (a person further up the floor casts a smaller
ellipse) and it must survive a horizontal flip, which a baked asymmetric blob does
not.

> ⚠ **KNOWN BUG, introduced by the sprite integration.** Swapping the `<svg>` for a
> `<span>` dropped `<ellipse class="ch-shadow">` along with it, so the office
> currently has **no status light under anybody**. The ellipse has to come back as a
> sibling of the sprite, not inside it.

---

## 8. One node is ONE figure — even when the work is parallel

`ActorView.id` is the **node** id, so the office draws one person per employee, and
the scheduler genuinely runs several tasks at once (`concurrency`, AIMD,
`runningByTier`). One worker fanned out across three tasks is still one body, and a
body cannot be in three places.

### ⛔ Do NOT serialise the trips

The tempting fix — *walk to station 1, finish, walk to station 2, …* — makes the
room **lie**. It would animate serial work while the machine runs in parallel, and
by the time the figure arrived at station 3 that task would have been over for a
minute.

### The rule: the figure shows WHERE ATTENTION IS, not a queue

This is the existing doctrine, not a new one — *a trip is an intention, and
intentions expire*. So:

- one figure, one current destination
- the **newest** signal wins; arriving is not required before re-targeting
- a trip that is overtaken is abandoned, not queued

That is also what a real person with three terminals open looks like: standing at
whichever one they are touching now.

If parallelism has to be **visible**, it belongs in the speech bubble or a small
count badge — never in the body, which has exactly one pair of feet.

---

## 9. Who looks like whom — evaluating the assignment rules

Today: `character = layout.cast?.[nodeId] ?? castOf(officeId, nodeId)` — a stored
choice wins, otherwise a pure hash.

### Why fairness is genuinely needed

With 5 characters and 5 employees, a pure hash gives all-distinct with probability
`5! / 5⁵` = **3.8%**. Collisions are not a risk; they are the default.

### Rule A — "always assign the least-used character"

Sound, **but only as assign-once-and-store.** `cast.ts` states the virtue the hash
buys: *"hiring or firing somebody never shifts anybody else's face."* A counter that
is **recomputed** destroys exactly that — fire one person and everybody behind them
in the ordering shifts.

⇒ Pick the least-used character **at hire time**, write it into `layout.cast`, and
never recompute. Firing then shifts nobody, because every face is already stored.

⚠ **Count only LIVE nodes.** Including deleted employees makes the counter describe
company *history* rather than the room being looked at; after twenty hires and
nineteen departures it would be permanently skewed for no visible reason.

### Rule B — "the first five wear the original colours, later ones get variants"

Good, and it degrades in the right direction: a collision becomes *the same person
in a different shirt*, which is readable, instead of *two identical people*.

### ⚠ But runtime recolouring of these PNGs is a trap

Measured on the delivered sheets: **40% of pixels carry partial alpha** — the art has
soft shading. So:

- exact-colour replacement leaves a fringe of un-replaced blend pixels
- `hue-rotate` shifts the **skin** as well, which is the compromise the old Lottie
  manifest had already written down as a known defect

Three routes:

1. **Pre-generated variants.** Ask for the same character in 2–3 shirt colours. Zero
   code, perfect quality — but the colours are **frozen at generation time**, so the
   user cannot pick one. Ruled out by Rule C below.
2. **A tint mask — CHOSEN.** See §11.
3. **Trace to SVG — not recommended.** It buys the same capability as (1) and (2)
   while destroying the soft shading that makes this art look good, and produces
   hundreds of unnamed paths per character.

### Rule C — "the user can set the worker or the shirt"

Half built already: `office/CharacterPicker.tsx` lets somebody pick a character per
node and writes it to `layout.cast`. Shirt colour would be a second axis on the same
surface.

> ⚠ `CharacterPicker` still draws its swatches with `Character` (the hand-drawn
> fallback), so it currently previews something the room no longer shows. It has to
> render the sprite, or people will pick twice — which is the exact failure its own
> header comment warns about.

---

## 10. Size and zoom

### The people are too small, and the cause is the room

`CH_H = 133` in a `1600 × 900` world makes the room **twelve people wide** — that
reads as a hall with a few figures in it, not as an office.

Two ways to fix it:

- **Raise `CH_H`** — but that re-opens the recorded 5-heads proportion decision and
  changes every sprite's rendered size.
- **Shrink `WORLD`** — recommended. It touches no artwork and no proportion ruling;
  the same people simply fill more of the frame.

⚠ **But every furniture coordinate is in world units** — `STATIONS`, `BREAK_AREA`,
`ownSpot()`, `ringSlots()`. Shrinking `WORLD` means re-laying the room. Do it **when
the generated furniture arrives**, sized against the real pieces; doing it first is
laying out a room for objects whose dimensions nobody knows yet.

### Zoom

Wheel and buttons, with limits:

| | |
|---|---|
| fit-to-window | `1.0` — the whole room visible, the current behaviour |
| minimum | `0.75` — enough to see the room sit inside its frame |
| maximum | `2.5` — a face fills a comfortable part of the screen |

⚠ **Zoom must be applied in `fit()` and nowhere else.** That function computes the
single transform that keeps the SVG room and the HTML actor layer in register:

```js
const k = Math.min(r.width / WORLD.w, r.height / WORLD.h);
```

Zoom is a multiplier on `k`, inside that same function. Applied anywhere else — a
CSS transform on one layer, a viewBox change on the other — the two layers drift
apart by a pixel and stop being one picture. That register is the whole reason the
movement loop can go on writing plain world units.

---

## 11. Recolouring: ONE region per character, through a mask

### 🔴 Exactly one garment is tintable, and it is named per character

Not "the clothes" — **one region, chosen because it is the one that can change without
the character stopping being themselves.**

| Character | Tintable | Stays fixed |
|---|---|---|
| c0 · long hair | the **shirt** | trousers, lanyard, shoes, hair, skin |
| c1 · bob | the **outer jacket only** | the **inner tee stays white**, trousers, shoes, hair, skin |

An inner layer left white is what keeps a tinted outfit reading as an outfit rather
than as a colour swatch with a head on it. Trousers stay dark for the same reason —
two tinted regions on one small figure is a costume, not a person.

### ✅ VERIFIED, not proposed

Tested on the delivered `c0` strip before asking for any mask to be drawn: a mask
was derived by colour range, five tints applied, the page rendered and looked at.

- the shirt takes the new hue; **folds and highlights survive intact**
- skin, trousers, lanyard, hair and shoes are untouched
- the five results land in the **same value range**, so a cast tinted this way stays
  visually coherent instead of one person glowing brighter than the rest — a free
  benefit of taking luminance from the artwork

⚠ One `file://` trap found while testing: `mask-image` is blocked by CORS from a
local file, so a test page has to embed the mask as a `data:` URI. Vite serves over
HTTP, so this does not affect the app.

### The mask is a second strip, generated alongside the first

Same 1200×275 geometry, same six cells, same anchor. **The tintable region in solid
white; everything else fully transparent.** Nothing else — no outline, no shading,
no other garment.

### ⚠ THE SEPARATOR IS LIGHTNESS, NOT HUE — a prediction that was wrong

This document previously asserted that `c1` would need a hand-drawn mask, because
its jacket and trousers are "both dark grey" and therefore inseparable. **Tested, and
that was wrong.** Both characters auto-derive cleanly:

| | Rule | Result |
|---|---|---|
| `c0` shirt | cool + saturated | ✅ 13 478 px, trousers untouched |
| `c1` jacket | cool + **luminance 38–118** | ✅ 16 744 px, trousers untouched, inner tee still white |

The jacket and the trousers *look* like the same grey, but they are not the same
**lightness** — the jacket sits in a mid band, the trousers below it, the inner tee
above it. A luminance window separates all three; hue never could.

⚠ And the "smarter" version was worse: adding a positional constraint (*only tint
above the waistline*) **cut the jacket's hem off**, leaving an untinted grey band
across the bottom of the garment in every pose. Geometry rules break on the poses
where the geometry moves — which is all of them.

⇒ **Derive the mask by colour+lightness first, render it, and look.** Ask for a
drawn mask only when that fails.

### Making auto-derivation reliable by construction

It worked here partly by luck. Remove the luck by requiring it in the prompt:

```
The recolourable garment must differ clearly in LIGHTNESS from every other
garment on the figure - noticeably lighter than the trousers and noticeably
darker than any inner layer - so it can be isolated programmatically.
```

That single line does double duty: it is also what gives the tint its range (below).

```
char-01.png        the character
char-01-mask.png   the tintable region, solid white on transparent
```

### 🔴 Tint by BLENDING, not by filling

Painting flat colour through the mask **destroys the shading** and the garment goes
back to looking like clip-art — the exact defect that got the first hand-drawn cut
rejected.

Instead: a colour layer masked to the region, composited with `mix-blend-mode:
color`. That blend takes **hue and saturation from the tint** and **luminance from
the artwork underneath**, so every fold and shadow the generator drew survives.

Three things this needs, all cheap:

- the tint layer carries the **same** `background-position` / walk animation as the
  sprite, or the colour slides off the jacket mid-stride
- `isolation: isolate` on the actor, or the blend reaches down into the room behind
- `mask-image` **and** `-webkit-mask-image`, for Safari

Still zero JavaScript: the frame, the walk and the tint are all CSS on one node.

### ⚠ THE BASE GARMENT MUST BE MID-TONE, OR TINTING HAS NO RANGE

`mix-blend-mode: color` keeps the original **luminance**. A near-black jacket tinted
yellow stays a near-black jacket with a faint yellow cast — the hue changes and
nothing else does.

So the recolourable region must be authored at **medium lightness** (roughly L 45–65
in HSL). `c0`'s medium blue shirt is a good base. **`c1`'s jacket is currently too
dark** — as delivered it will only ever produce muted variations of dark grey.

⇒ Add to the generation prompt, for the tintable garment only:

```
The [shirt / outer jacket] must be a MEDIUM-LIGHTNESS colour - not near-black
and not near-white - because it will be recoloured programmatically later and
a very dark or very light garment leaves no room to shift its hue.
Every other garment keeps its own fixed colour.
```

### Where the chosen colour comes from

`CastMember.garment` is already an index into the `--cast-1..10` token array, so the
data model needs nothing new — the index simply stops selecting a *drawn* colour and
starts selecting a *tint*. Rule B then falls out for free: the first five employees
get each character's authored colour (**no tint layer at all**), and only from the
sixth does a tint get applied.

⚠ Which also means the tint layer must be **absent, not transparent**, for an
untinted character. A `mix-blend-mode` layer at zero opacity still forces a
compositing pass per person, every frame they move.
