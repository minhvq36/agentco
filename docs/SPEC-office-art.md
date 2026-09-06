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

### 🔴 `walk1` and `walk3` must have OPPOSITE legs forward — v1 0/5, v3 **4/5**

Measured on the five v1 characters: **every one had the same leg leading in both
contact frames.** Only the stride width changed. That is not a walk, it is
**trembling in place**.

Measured again on the v3 sheets, with the construction block below in the prompt:
**2.3, 3.3, 4.3 and 5.3 alternate; 1.3 does not.** So the block works and the failure
is now a per-sheet re-roll, not a prompt problem.

#### ⚠ HOW TO TELL — the silhouette CANNOT answer this, the wristwatch can

The character always walks to the right, so in **both** contacts one foot is forward
and one is back. Contact and contact-reversed therefore have **nearly the same
outline**, and every silhouette measurement returns the same answer for both.

Two measurements were run before this was understood, and both were the wrong cell:

| Measurement | What it actually tested | Verdict |
|---|---|---|
| shin-run luminance, left vs right | *is the trailing leg shaded darker* — true in every frame because the trailing leg is always the left one | ❌ useless |
| leg overlap at the crotch | nothing: in a wide contact the legs do not overlap at all, so the layering that encodes near/far is **absent from the drawing** | ❌ useless |

What works: **a per-arm marker.** These characters wear a wristwatch on one wrist. The
arm swings opposite to the leading leg, so:

```
watch-arm FORWARD in walk1 and FORWARD in walk3  ⇒ same phase   ❌
watch-arm FORWARD in walk1 and BACK    in walk3  ⇒ alternating  ✅
```

Crop the torso band of `walk1` and `walk3`, put them side by side, and look for the
watch. It is unambiguous, it costs one crop, and the model cannot fake it — a watch
belongs to one arm. Any asymmetric detail does the same job (a bag, a badge on one
sleeve, a rolled cuff on one side only); ask for one deliberately if a future cast has
none.

⇒ **Judge the walk by the ARM, not the legs.**

The instruction *"pose 4 has the opposite leg forward"* alone was ignored five times
out of five. Stating the requirement is not enough — the model collapses both contacts
into one generic walking pose. It has to be told **how to construct** the second one:

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

### 🔴 A RE-ROLL REPLACES THE WHOLE SHEET. NEVER SPLICE ONE CELL IN.

When v3 arrived with the walk fixed, the cheap-looking move was to cut its `walk3` out
and paste it into the shipped v1 strip. **Measured, and it does not work:**

| | v1 (shipped) | v3 |
|---|---|---|
| canvas | 1320 × 300 | **2048 × 768** |
| wristwatch | absent | **present** |
| hair silhouette | — | different fringe and volume |

One spliced cell puts a wristwatch on one frame out of six. At `steps(4)` over 0.62 s
that is a watch **blinking 6.5 times a second**, plus a hair silhouette that jumps —
the exact judder §"Why one sheet and not six files" exists to prevent, arriving through
a door that looks like a shortcut.

⇒ **The sheet is the unit.** A character is re-rolled whole or not at all, and the
cells of two generations never mix.

⚠ The resolution row is also a reason to take the whole sheet even when the old one
was acceptable. With `CH_H = 177` and the `2.5×` ceiling a person renders up to
**~442 px** tall; a v1 cell carries ~258 px of body and is being **upscaled 1.7×**.
v3 downscales into that instead. Sharpness at max zoom is free with the new sheets and
unobtainable with the old ones.

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

## 3. Furniture sheets

Same frame, same anchor, **one cell per object** — never a whole room in one cell.

**Three sheets, and the split is by ANCHOR RULE, not by convenience.** One sheet
cannot carry two anchor conventions without somebody having to remember which cell is
which; that is the whole reason there is a second sheet at all.

| Sheet | Canvas | Anchor | Cells |
|---|---|---|---|
| **1 · floor** | 2400×275 | footprint on the bottom edge | ~~`desk`~~ ~~`chair-office`~~ `stool` `bookcase` `sofa` `table-low` `foosball` `table-chess` `counter` `plant` `cabinet` `cooler` |
| **2 · wall** | 1400×275 | centred, touching nothing | `window` `whiteboard` `clock` `picture` `pinboard` `shelf` `plant-hanging` |
| **3 · station desks** | 600×275 | footprint on the bottom edge | `desk-laptop` `desk-files` |

Ids are the keys in `art/furniture.ts`, and they are the names on disk. Struck cells
are **retired by sheet 3** — sheet 1 is not regenerated, the two PNGs are deleted, and
the three call sites in `Room.tsx` move to the new pieces.

### Sheet 3 — a station should say what happens there

`desk` was one drawing used at **both** working stations, so the connections bench and
the results desk were the same object twice and neither said what it was for. The
label under each station carried the entire meaning, and the picture carried none.

| Station | Piece | What the picture says on its own |
|---|---|---|
| connections · `STATIONS.arm` | `desk-laptop` | a modern laptop, open — *this is where tools plug in* |
| results · `STATIONS.artifacts` | `desk-files` | a longer desk under stacks of paper — *this is where output lands* |

#### The laptop is BAKED INTO the desk, not its own cell

A separate laptop would have to be placed on the desk's **work surface**, and no
number anywhere says where that surface is: `Piece` carries `h` and `ar`, and neither
of them locates a desktop. Placing it would mean a hand-tuned magic offset per desk —
a number with no source, which drifts the first time the desk is regenerated.

Baked in, the pair is one footprint at one anchor, like every other floor object.

#### 🔴 `desk-files` needs a DOUBLE-WIDTH slot — a generator trap

`gen-furniture` derives world height from **pixel** height:

```ps1
$h = [math]::Round($ph * $FLOOR_K)     # $FLOOR_K = 177 / 321
```

A model asked for a long desk inside a 200 px slot draws it **scaled down to fit** —
it comes back long *and short* — and the derived `h` then puts a filing desk at knee
height. Nothing downstream can recover that: `ar` and `h` are both measured off the
same squashed picture, so the two numbers agree with each other and disagree with the
room.

⇒ Give it a **400 × 275** slot, and state the height *relative to the neighbouring
cell* rather than in pixels, so length costs nothing in height.

⚠ `$FLOOR_H` in the generator exists for corrections of exactly this class (`cooler`
measured 112 and was overridden to 133). Using it here would be treating the symptom:
forcing `h` back up while `ar` still describes a squashed drawing stretches the desk.

#### The office swivel chair is retired

Nobody sits at the connections bench. §5 is explicit that the break area is the only
place with seats, and `pose: 'sit'` is only ever set there — so the chair is an empty
seat beside a desk nobody sits at, and an empty seat reads as **absence**, not as
furnishing. It is the one object in the room that says something untrue.

It is also the only piece that would need an occlusion split for no gain: a person
standing at the bench overlaps it, and splitting a chair in two to fix that buys a
chair.

### Furniture that people USE has to say where they stand

Three decisions, each driven by **who occludes whom**, not by realism.

#### The seat is BACKLESS, and that removes a dependency

A chair with a backrest sits *behind* a seated person, so its backrest shows around
their shoulders — which means the backrest's width and height have to agree with the
torso of **all five characters**, and they differ. A backless stool shows nothing
above the seat: every mismatch is hidden by the person sitting on it.

Layer order, which is the whole reason the stool is a separate cell rather than
being drawn attached to the table:

```
stool  (behind)  →  the seated person  →  chess table (in front)
```

⚠ **Seat height matters and was measured, not guessed.** In the `sit` cells the hip
line sits at **31 / 33 / 34 %** of standing height for `c2`,`c3`,`c4`. (`c0` and `c1`
measured 51–52%, but that is the widest row catching their **hair**, not their hips —
a reminder that a precise number can still measure the wrong thing.)

⇒ the stool's seat is **about one third of an adult's standing height**, ≈ 70 px in a
275 px cell. Too high and the character floats; too low and they sit on the floor.

#### The foosball table points AWAY from the viewer

Long axis into the screen ⇒ the two players stand **left and right**, both fully
visible, **neither occluding the other**, and the table needs no front/back split.

Long axis across the screen would put one player behind the table, occluded from the
waist down — a nicer depth cue, but it costs an occlusion split and hides a person.
Not worth it here.

#### A counter, not a coffee machine — and not a bar

People queue **in front of** a counter, shoulder to shoulder, all fully visible. A
standalone machine is too small to furnish anything and seats one person's worth of
attention. A pub bar implies a bartender, which is the wrong register for an office.

The counter is also the widest object in the set, so it does the most work against
the empty-room problem. It is distinct from `lowtable`: the counter is where a drink
is **fetched**, the low table is where it is **drunk sitting down**.

### Anchor for furniture — TWO conventions, and mixing them breaks the room

| Kind | Anchor | Examples |
|---|---|---|
| **Floor object** | the **footprint touches the bottom edge**, same convention as the feet | desk, chair, shelf, sofa, plant, cabinet |
| **Wall object** | **centred in the cell, touching nothing**; the code places it at a wall height | window, whiteboard, clock, picture, pinboard |

A floor object that floats above the bottom edge will float above the floor. A wall
object drawn touching the bottom edge will be planted on the floor like a sheet of
glass leaning against the wall.

⇒ **Wall objects go in their own sheet**, because one sheet cannot carry two anchor
rules without somebody having to remember which cell is which.

### ⚠ The back wall is the emptiest surface in the room

`Room.tsx` gives the wall `y 0…360` — **40% of the room's height** — and puts exactly
one window on it. The floor already has a bookcase, two desks and a break area; the
wall has almost nothing. Filling the wall buys more perceived furnishing per object
than anything placed on the floor.

⚠ But more objects is **not** the fix for the room feeling empty. The room is twelve
people wide (§10); adding furniture to a hall makes a furnished hall. Shrink `WORLD`
first, using the real dimensions of the generated pieces, then add what the smaller
room still needs.

### 🔴 CORRECTION — THERE IS NO OCCLUSION LAYER, AND EVERYTHING BELOW IS A PLAN

Measured 06/09, and it invalidates the premise of the next two paragraphs. `DomScene`
draws the room as an `<svg>` and the people as an **HTML layer stacked on top of it**.
That split is deliberate and load-bearing (§DomScene: a bitmap sprite is an ordinary DOM
node, and reaching one from inside an `<svg>` means `foreignObject`) — but its
consequence had never been written down:

> **Every actor is drawn in front of every piece of furniture. Always.** No `<image>`
> in the room can occlude anybody, whatever order it is painted in, because the whole
> room is painted before the first person is.

So Rule 2's *"a person walks behind the bookshelf and in front of the filing desk"* is
true of the **coordinates** and false of the **pixels** — and `Room.tsx` carried a
comment claiming the layer order *"stool (behind) → the seated person → chess table (in
front)"*, which the renderer has never been able to honour. That comment is gone.

⇒ Until a renderer exists that can interleave the two, **depth is bought by POSITION,
not by layering**: an object that must appear in front of somebody is placed lower on
the floor (see the chess table in §5). The split below stays as the design for the day a
renderer can use it; nothing today should be authored as if it works.

### ✅ …with EXACTLY ONE exception, and it is not a depth system

**06/09.** The chess table is the one object where "everybody is in front of it" reads
as broken rather than as flat: the player sits **behind** the board, so a body drawn
over it is a body standing in the middle of the game — and anyone merely walking past
the break area wiped the table out.

`BreakPiece.front` moves a piece's **art** into `RoomFront`, a second `<svg>` mounted
after `.office-stage`. Two pieces carry it: `table-chess`, then the near `stool`.

| | |
|---|---|
| geometry | **every attribute identical to the room's** — same box, same `viewBox`, same `preserveAspectRatio`. `fit()` never learns it exists; it already keeps two layers in register and a third with its own transform is the one that drifts |
| `pointer-events` | **none.** It covers the whole room, so without it the stations underneath stop taking clicks — a door only a keyboard can open |
| the shadow | **stays in the back layer.** A shadow is on the floor, so a person standing over it should cover it while the table casting it should not. Keeping the pair together puts a smudge on top of somebody's shoes |

🔴 **IT SORTS BY NOTHING.** Every piece in the front layer beats every person whatever
their `y`. That is correct for a table only ever approached from behind and wrong for
anything anyone can stand in front of — put the sofa in here and somebody crossing the
room vanishes behind its backrest. **Adding a second `front` piece is a design decision,
not a tweak.** Real depth would need a per-frame sort across two layers that do not
share a coordinate system, and nothing in this room is worth that.

#### ⚠ And it moved the chess seat, through a rule that spans two files

With the table in front, the seated player's feet are hidden by it — *provided they land
below its top edge*. They did not: `sitLift` (§9) raises the seated **drawing** by up to
30 world units without moving the anchor, and at `stool.baseY + 4` the most-lifted sheet
came out **standing on the chess pieces**.

`CHESS_SEAT` now places the player forward of the stool by more than the largest lift —
which is also what a person sitting on a stool actually does with their feet.

⚠ **The constraint spans `core` and the art manifest, so it is checked in the one place
both halves are visible.** `core/cast.ts` declares `MAX_SIT_LIFT`; `art/manifest.ts`
throws at load if any sheet exceeds it; `Room.tsx` throws at load if a lifted player's
feet would reach above the table's drawn top edge. Three files, two throws, no comment
pretending to be a mechanism — because the failure it catches is silent, slow, and gets
looked for in the sprite sheet.

### Occlusion split

Anything a person can walk **behind** and also stand **in front of** must be split
into two cells, drawn either side of the actor layer:

```
desk-files-back    the part that is behind a person standing at it
desk-files-front   the desk top and legs that occlude their shins
```

Only split what needs it. `bookcase` and `cabinet` sit against the wall and are always
behind; `plant` is always in front or always behind depending on its y.

⚠ `desk-files` is the piece that most needs this and the reason is its **length**: it
is the widest thing anyone stands at, so it is the one where "everybody is in front of
it" is most obviously wrong. `desk-laptop` is narrow enough that the ring puts people
beside it rather than behind it.

⚠ And `shelf` in that list means the **bookcase**, not the wall id `shelf`. Two
different objects, and the collision is in the shipped ids — see the sheet table above.

### The prompts — TWO SHARED BLOCKS, THEN ONE DELTA PER SHEET

> ### ⚠ THE SHARED LINES EXIST IN ONE PLACE BECAUSE THEY GOT BROKEN ONCE
>
> The first generation came back **2032×774** instead of the stated canvas, painted
> rather than flat, with a red fringe on every edge, objects floating in the middle of
> the frame, and only 9 of the 11 objects asked for. The anchor failure is
> recoverable — the normaliser re-seats everything on the bottom edge — the painterly
> style and the fringe are not.
>
> Those lines used to be copied into every furniture prompt. **A rule living in three
> places gets fixed in one of them and left broken in the other two**, and the two
> that stay broken are the ones nobody re-reads. So they are written once here.
>
> To generate a sheet: **block A**, then **block B if it is a floor sheet**, then the
> sheet's own `CANVAS` + `OBJECTS`. Nothing below repeats them.

#### Block A — style, palette and separation · EVERY furniture sheet

```
Generate a 2D game furniture sprite sheet, FLAT VECTOR cartoon style with
solid colours - matching office-worker characters drawn in the same flat style.

SEPARATION: leave a band of fully transparent pixels between neighbouring
objects. No two objects may touch or overlap.

STYLE: FLAT SOLID COLOURS ONLY - like a vector illustration, not a painting.
No gradients, no brush texture, no soft shading, no drop shadow, no ground
shadow, no background, no text, no logos, no people. No coloured fringe or
halo on any edge. No outline; shapes are defined by flat colour alone.

PALETTE: floor #fbfaf8, wall #f4f1eb, furniture body #ffffff to #e7e3dc,
warm accent #b4532a, wood #6b5344, dark parts #2f2a22
```

> ⚠ `SEPARATION` is new, and it is there because of the **split**. The delivered floor
> sheet had two objects touching at a zero-pixel gap, which took the segmenter from
> one algorithm to three — fixed gap (9/12), then merge-smallest-gap (11/12), then a
> waist cut down the lowest-density column of the widest run (12/12). One line in the
> prompt is cheaper than the third algorithm, and it is cheaper every time after that.

> Swap the `No outline...` clause for
> `Include a dark brown outline (#2b2620) around every shape.` if the room keeps its
> contour line. It is the **same switch as §2** and it has to be flipped on the
> characters and the furniture together — that is the whole finding of §4.

#### Block B — floor anchor, scale and angle · FLOOR sheets only (1 and 3)

```
ALIGNMENT:
- The BASE of each object - where it meets the floor - touches the very
  BOTTOM edge of its slot. No empty space below any object.
- Each object horizontally CENTERED in its slot.

SCALE: these share a room with adults about 210 px tall in this same 275 px
slot height. A desk reaches their hip; a bookcase is about their height;
the counter reaches their waist.

Slight front-above viewing angle, consistent across every object.
```

⚠ Block B is **floor-only**, and not just because of the anchor: it ends with a
front-above angle, while the wall sheet needs *straight on, flat to the wall*. Pasting
B into the wall prompt tilts everything that hangs.

#### Sheet 1 — floor furniture · A + B + this

> ⚠ Reproduced **as sent**, because it is the provenance of the shipped PNGs. Cells 1
> and 2 are retired by sheet 3; regenerating this sheet today asks for **ten** objects
> in a **2000×275** canvas.

```
CANVAS: one single image, 2400x275 pixels, fully TRANSPARENT background,
twelve objects in a single row, evenly spaced, each in its own 200x275 slot.
Output ONE image, not twelve separate images.

OBJECTS, left to right:
 1. DESK
 2. OFFICE SWIVEL CHAIR, front view
 3. SQUARE STOOL - backless, low, about one third of an adult's standing
    height (roughly 70 px tall in this 275 px slot). Same warm orange
    upholstery as the sofa. Seen slightly from above, seat surface visible.
 4. BOOKCASE
 5. TWO-SEAT SOFA
 6. LOW COFFEE TABLE with two cups
 7. FOOSBALL TABLE - long axis pointing AWAY from the viewer, so players
    would stand at its left and right sides
 8. CHESS TABLE - small square table, board on top, seen slightly from above
 9. PANTRY COUNTER - a low counter with a coffee machine and cups on it
10. POTTED PLANT
11. FILING CABINET
12. WATER COOLER
```

#### Sheet 2 — WALL objects · A + this

Same cell size, **different anchor**: each object is centred in its cell and touches
nothing. Height on the wall is decided by code, not by the picture.

```
CANVAS: one single image, 1400x275 pixels, fully TRANSPARENT background,
seven objects side by side, each occupying exactly 200x275 pixels.
Output ONE image, not seven separate images.

OBJECTS, left to right:
1. WINDOW      - a bright window with a simple frame and a sill
2. WHITEBOARD  - with a few faint marks on it
3. WALL CLOCK  - round, simple
4. FRAMED ART  - one framed picture
5. PINBOARD    - cork board with a few small notes pinned to it
6. WALL SHELF  - a floating shelf with two books and a tiny plant
7. WALL PLANT  - a hanging trailing plant

ALIGNMENT (different from floor furniture - read carefully):
- Each object is CENTERED in its 200x275 cell, both horizontally and
  vertically. It must NOT touch the bottom edge - these hang on a wall,
  they do not stand on the floor.
- Keep a 10% margin on all four sides.

SCALE: in a room where an adult is about 210 px tall, the window is roughly
chest-to-head height, the clock is about one head wide.

Viewed straight on, flat to the wall - NOT from above.
```

#### Sheet 3 — station desks · A + B + this

Two objects, **two different slot widths**. The unequal slot is the point, not an
accident — see the generator trap above.

```
CANVAS: one single image, 600x275 pixels, fully TRANSPARENT background,
two objects in a single row.
Output ONE image, not two separate images.

The two slots are NOT the same width:
- slot 1 spans x 0 to 200
- slot 2 spans x 200 to 600, which is TWICE as wide

OBJECTS, left to right:
1. LAPTOP DESK - a plain work desk with one modern thin laptop open on it.
   The laptop's screen faces AWAY from the viewer, so only the back of the
   lid and the hinge are visible - no screen contents. Slim body in dark
   grey or silver, thin lid, low profile. Nothing else on the desk.
2. LONG FILING DESK - the SAME desk as object 1 but about twice as long,
   with paperwork on it: two or three neat stacks of documents, one open
   folder, a few loose sheets. NO laptop and NO screen on this one.

CRITICAL - length must not cost height:
Object 2 is longer than object 1 and must NOT be shrunk to fit. Its desktop
surface sits at EXACTLY the same height as object 1's, it has the same
depth and the same legs, and both bases touch the bottom edge. It is the
same desk made longer, not a smaller copy of it.
```

⚠ The screen faces away deliberately. Turned toward the viewer at a front-above angle
it is a large blank rectangle that reads as a whiteboard lying down, and it invites
exactly the screen text and logos that block A bans. The back of a lid plus a visible
hinge and keyboard base reads as *laptop* with nothing on it to get wrong.

⛔ **Do not generate a rug.** The break area's rug is already one flat rounded
rectangle in `Room.tsx`; a bitmap rug would have to be drawn in perspective and
would fight the floor it sits on.

⛔ **Do not generate the floor or its tiling.** The floor has to stay crisp at the
`2.5×` zoom ceiling and has to re-tile itself when `WORLD` shrinks (§10) — both are
things a vector path does for free and a bitmap cannot do at all. It is a handful of
lines in `Room.tsx`, drawn once into a `memo`'d layer that never re-renders.

⚠ And when it is drawn: **horizontal bands, not a grid and not converging lines.**
A square grid reads as a top-down floor and fights the front-facing wall above it;
converging lines claim a vanishing point, which then obliges every character to
scale with depth. Bands spaced closer toward the horizon give the depth cue without
promising either.

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

### ✅ The room's palette, 06/09 — named values and no line

| | | |
|---|---|---|
| `--room-wall` | `#F9FAF3` | the lightest surface |
| `--room-floor` | `#F2EFE6` | one step darker |
| `--room-baseboard` | `#D9D0C5` | darker again, the bottom 16 units of the WALL |
| `--room-plank` | `#E9E4D6` | the board seams, barely a step off the floor |
| `--room-break-floor` | `#C8DBBB` | the one part of the floor that means something |

⚠ **The break area is the only hue change in the room, and that is the point.** Every
other surface is a step on one warm neutral ladder; green says *this ground is a
different place*, which no fourth beige could.

#### 🔴 The floor's seams CONVERGE, which reverses what §3 asked for — read this first

§3 (below) says *"horizontal bands, not a grid and not converging lines"*, and gives
the reason: **converging lines claim a vanishing point, which then obliges every
character to scale with depth.** That cost is real and it has **not** been paid —
`CH_H` is one number and a person is the same size at the back wall as at the front.

The user overruled it (06/09) with the trade named: a board floor whose boards run
parallel reads as a printed pattern rather than as a floor. The fan is kept **shallow**
for exactly the reason §3 gives:

| | |
|---|---|
| vanishing point | `HORIZON − 1800` — far outside the picture |
| spread across the visible floor | **≈30 %** from the back wall to the front edge |
| seam spacing at the horizon | 38 world units |

⚠ **Pull the vanishing point closer and the floor turns into a road**, and the day it
does, the figures standing on it will start looking wrong at the back — which is the
prediction §3 made and the reason this section states the number rather than the taste.

Drawn as **one `<path>`** of ~170 segments, built at **module load** (it depends on
nothing that changes) rather than as 170 `<line>` elements or a `<pattern>` — a pattern
cannot fan.

#### 🔴 FULL BLEED — the white bars were the letterbox, and the fix is PAINT

`preserveAspectRatio="xMidYMid meet"` fits a 1600×900 world into a frame of some other
shape, so one axis is always left over. Both obvious cures are wrong:

| | Why not |
|---|---|
| `slice`, or `Math.max` in `fit()` | fills the frame by **cropping the room**. The break area or the front row goes off screen, silently, and only on some window shapes |
| growing the `<svg>` box past `.office-pan` | `fit()` places the HTML people from the **root** rect while the svg fits itself to its **own** box. Change one and the two layers drift apart by exactly that much — and that register is what the entire two-layer design rests on |

⇒ **Keep the geometry untouched and paint further.** Wall, floor, baseboard and planks
all run to `±BLEED` (2400 world units); the outer `<svg>` clips them to its viewport.
Nothing moves, nothing is cropped, and the bars fill with the surface that was already
next to them. 2400 covers past a 40:9 window and costs four rectangles that never
re-render.

⚠ `.office-root`'s background is the floor colour as a **backstop only** — it shows in
the strip `.office-pan` uncovers on the left while the sidebar pushes it, which the
sidebar itself then overlays.

🔴 **They are named values, not `color-mix` off the app tokens.** The wall used to
be mixed from `--color-panel` and `--color-line`, and the floor *was*
`--color-paper` — so the room's two largest surfaces were a side effect of the chat
panel's palette, and **the floor was the same colour as the page behind it**. There
was no floor; there was furniture on a background.

Depth now comes from the **ladder** — wall lighter than floor, baseboard darker than
both — and that is why the near-black `.skirting` stroke is gone. A 1.75px hard line
along `HORIZON` was the sharpest edge in the picture and every object against the
back wall had its feet **on** it, which reads as *mounted to the wall*. A band of a
third colour says where the wall stops without pretending to be an edge anything can
rest on. The other half of that fix was moving the furniture 44 units into the room
(§STATIONS).

⚠ **The break area is a patch of floor, not a panel.** It was a dashed, stroked,
rounded rectangle — the vocabulary of a drop target, borrowed from the canvas. Inside
a room that vocabulary says *this is a piece of interface*. No stroke at all now:
softening the border would have kept the box and made it quieter.

⚠ **Both contact shadows dropped from `0.34/0.14` to `0.22/0.09` in the same change,
and that is not taste.** The same alpha on a floor that stopped being the page colour
reads about a third heavier. The person's ellipse and the furniture's gradient carry
identical numbers and **move together or not at all** — two shadow recipes in one room
is two light sources.

⚠ **And the per-sheet scale settled at 1.1, not 1.2.** Reviewed at the shipping size
(§0): a fifth taller made c2/c3/c4 the *tall* ones instead of the short ones, which is
the same complaint arriving from the other end.

---

## 5. Break area layout

### It takes the WHOLE RIGHT SIDE, and it holds exactly SIX

Six named places, each a fixed point — not a capacity, a **seat with coordinates**:

| # | Seat | Pose | Note |
|---|---|---|---|
| 1–2 | Sofa, left and right cushion | `sit` | |
| 3–4 | Foosball, left end and right end | `stand` | long axis away ⇒ neither occludes the other |
| 5 | Counter | `stand` | **one**, not two — a queue of two at a coffee machine reads as a queue, not as a break |
| 6 | Chess table | `sit` | needs its **stool**, and the stool has to be visible behind the sitter |

All four poses already exist on the character sheet, so no extra cells are required.

### 🔴 NOBODY IN THE BREAK AREA EVER MOVES

`breakSpot(seed, step)` returns a **seeded random point inside the rectangle** and
`idleDelay` re-rolls it every 6–14 s, so resting people currently drift around. That
goes.

The reason is not tidiness. **Movement is this room's only vocabulary for work.** A
figure crossing the floor means something is happening — a task started, a result is
being carried to the desk. A resting employee wandering spends that signal on nothing,
and it makes an idle office look busy, which is the one thing the view exists to tell
the truth about. Six people milling in a corner is also what makes the eye read the
break area as the *subject* of the picture.

⇒ Resting ⇒ bound to a seat by index, `loiter: false`, and the figure is still. The
only thing that moves them is stopping resting.

### ⚠ THE RIGHT SIDE IS NOT EMPTY TODAY — two stations are standing in it

`BREAK_AREA` is `{ x: 1016, y: 588, w: 546, h: 296 }` — the bottom-right corner.
Growing it to the full right side (`y` from just under `HORIZON` down to the floor's
bottom edge) walks it straight into two stations. Measured against
`ringSlots()` in `core/office-floor.ts`:

| Station | Rect | Standing slots inside a full-height right-side break area |
|---|---|---|
| `arm` · connections | 1108…1420 × 226…360 — *above* `HORIZON`, so the rect itself is clear | **6 of 6.** `foot = 394`; slots run x 1049…1479, y 394…498 — every one on the rug |
| `artifacts` · results | 930…1198 × 432…548 — **overlaps by 182 units** | **4 of 6.** slots x 871…1257, y 582…686 |

So this is not a rug resize. **Both stations move left**, and `ringSlots` follows them
for free because it derives from the rectangle. `ownSpot()` does not need touching: its
arc spans x 46…994 for a row of five, already clear of x ≥ 1016.

⇒ The room becomes **work on the left, rest on the right**, which is also the reading
order and puts the two things a user compares — *is anyone working?* vs *is everyone
idle?* — on opposite sides of one glance.

⚠ `STATIONS` numbers are the authority that `ringSlots()` derives from (§0 Rule 2), so
moving one is a floor-plan decision, made once, in `core/office-floor.ts` — never a
nudge in `Room.tsx` to make a picture fit.

### 🔴 SIX IS A CEILING, NOT A STARTING POINT — the seventh is not drawn

**Decided by the user, 06/09.** Three options were on the table and the two that keep
everybody on screen were both rejected for the same reason:

| | Verdict |
|---|---|
| overflow **stands still** along the back of the area | ⛔ seven bodies in a 400-unit strip is a crowd, and a crowd in the corner makes the break area the **subject** of the picture — the same failure the wandering caused, by a tidier road |
| hidden **with a "+3 resting" badge** | ⛔ a second vocabulary for a state the diagram already spells out in words |
| **hidden outright** | ✅ shipped |

> The previous version of this section ranked *"hidden outright"* last and said: *"if
> this is chosen, **that rule must be edited to match** — a rule that misdescribes what
> it governs is worse than no rule."* It was chosen, so here is the edit.

**The rule that changes.** `Room.tsx` opens with *"THE ROOM IS NEVER EMPTY … there is
deliberately NO empty-state screen replacing the room."* That still holds, and it is
about the ROOM — it never promised that every employee appears in it. What is now
explicitly given up is narrower and worth stating plainly:

> ⚠ **Past the sixth resting employee, absence looks identical to non-existence in
> this view.** That is a real loss and it is bounded by two things, both of which have
> to stay true or the decision stops being defensible:
> 1. the **diagram** shows every employee and prints the word *resting* beside them —
>    the room is a second view of one office, never the only one;
> 2. the room's spoken summary (`office.summary`, the `<svg aria-label>`) counts
>    **everybody who is resting, drawn or not**.

**And it is a flag, not an omission.** `direct()` returns a placement for every person
and sets `rest: 'offscreen'` on the ones it is not drawing. Dropping them from the list
instead would make *"resting, off screen"* and *"not in this office"* the same shape of
data — and absence is not a signal. `Office.tsx` reads that one field for both
questions: *do I draw this person* and *how many are resting*.

⚠ The old renderer answered the second question with `pose === 'sit'`, which was
already wrong before any of this: it missed the two people at the foosball table and
the one at the counter, all three of whom rest on their feet. It counted three of six.

### ✅ Seats are wired — `BREAK_SEATS`, `BREAK_PIECES`, and one table for both

- a `BREAK_SEATS` table of six points **with a pose each** — the pose belongs to the
  seat, not to the person, because a sofa cushion means `sit` no matter who is on it
- assignment **by stable index**, not by `nearestFreeSlot`: a resting person is not
  walking in from anywhere, so "nearest" has no input, and re-deriving it as people
  come and go would shuffle everybody's seat. Same reasoning as `layout.cast` in §9 —
  **assign once, keep**.
- `breakSpot`, `idleDelay` and `Placement.loiter` are **gone**, together with the timer
  that drove them. Leaving `loiter` in place as a dead flag is how the wandering comes
  back a month later. `breakGame` went too — it had **no caller at all**, and with
  `BREAK_SEATS` the seat itself is the answer to the question it was asking.
- gate: `test/office-director.test.ts`.

#### 🔴 THE FURNITURE AND THE SEATS ARE ONE TABLE, BECAUSE THEY WERE TWO AND DRIFTED

The pieces were literals in `Room.tsx`; the seats were literals in
`core/office-floor.ts`. Both were written against the **old 546-wide corner rug**. When
the area moved to the right-hand wall at 400 wide, the two halves failed in different
directions and neither made a sound:

| | Where it ended up |
|---|---|
| the chess set | drawn at **x 1590 in a 1600-unit world** — off the floor entirely |
| its seat | 1460, so the sitter rested beside furniture that was not there |
| the sofa | drawn at 1486 with its cushions at 1403 and 1477 |
| the break-area plant | 1678 — 78 units past the right wall, never once rendered |

⇒ `BREAK_PIECES` now holds every object's `(x, baseY)` and `BREAK_SEATS` is **derived
from the same constants**. Moving the sofa moves the people sitting on it, and there is
no second number to forget. `Room.tsx` maps over the table instead of listing literals.

⚠ **The array order is painter's order**, and that is what buys the chess table its two
stools: far stool, table, near stool.

#### ⚠ The chess table sits 120 units BELOW its own far stool, and that is not a bug

Every actor lives in an HTML layer stacked **above the whole SVG room** (§DomScene), so
**no piece of furniture can ever occlude a person** — see the correction in §3. Placing
the board at the player's own depth therefore does not put them behind it; it hides the
board *under* them, and the object stops reading as a chess table.

Dropping the table until its top edge lands at the sitter's feet costs nothing: in a
front-above view a nearer object **is** drawn lower, so the board stays visible and the
geometry stays honest.

⚠ The number was walked in, in front of the user, four times: **98** put the far
stool's feet exactly on the table's top edge and it read as a stool *standing on the
board*; **120** opened a strip of floor wide enough that the stool stopped belonging to
the table; **100** still read as *near* the table rather than *at* it; **84** is the
answer. The gap has to be visible and small — and the seat follows the stool for free,
because `BREAK_SEATS` is derived from `CHESS_FAR` rather than typed beside it.

#### ⚠ 06/09 — the counter and the sofa swapped sides

The counter is a **service object**: you walk to it, take a cup, and leave. The sofa
is where you **stay**. With the sofa on the outer edge the whole seating group was
pressed into the wall and the traffic side of the area was empty. Counter right
(against the wall), sofa and low table on the inside, and the low table pulled to 56
units below the sofa rather than 68 — the pair has to read as **one** seating group,
and any further apart the table belongs to the room instead of to the sofa.

The foosball table moved right in the same pass: two game tables 170 units apart read
as one cluttered corner, 210 apart each is its own thing. It cannot go further — its
right-hand player would stand past the edge of the floor patch.

#### ⚠ The counter is not in the top-left corner, and the caption is why

`office.breakArea` is painted at `(x + 16, y + 26)`. A 120-unit counter anchored 120
units down covered it, and the area announced itself with the first four characters of
its name missing. **A caption a piece of furniture can stand on is a caption nobody has
placed.** The counter moved; the caption did not.

⚠ And the counter's *place* is offset to the right of its centre rather than squarely in
front. A person is taller than the counter and wider than half of it, so dead-centre
erases the whole object; standing at its right-hand end leaves the coffee machine — the
thing that says what the counter is — visible past their shoulder.

---

## 6. Delivery checklist

- [ ] **One file** at the stated canvas — 1200×275 characters · 2400×275 floor ·
      1400×275 wall · 600×275 station desks — not N files
- [ ] Real transparency (place it on black; it must still read as cut out)
- [ ] Cells in the stated order, left to right
- [ ] **A transparent gap between every pair of neighbours** — nothing touching
- [ ] 🔴 `walk1` and `walk3` have **opposite** legs forward
- [ ] 🔴 Face visible in all six cells — ¾, never a 90° profile
- [ ] 🔴 `sit` has **no chair**
- [ ] Base touches the bottom edge in every cell — **wall sheet excepted**, where it
      must touch nothing
- [ ] 🔴 On sheet 3: the long desk is the same **height** as the short one. Measure it;
      it is the failure mode the double-width slot exists to prevent
- [ ] No baked ground shadow — the room draws its own
- [ ] 🔴 **Exactly ONE connected island of opaque pixels per piece.** Flood-fill over
      alpha ≥ 24 and count components — `table-low.png` shipped with two and the second
      one rendered as a speck floating beside the sofa. → §13

On delivery the first step is **measurement, not integration**: cell height, body
height, horizontal centre, base line, skin tone, and a `walk1` vs `walk3` difference
check. Numbers get reported before any code is written — if the drift is large,
regenerating is cheaper than patching.

---

## 7. 🔴 The ground shadow is CODE, and it is not decoration

The generated art must not bake a shadow, and the reason is not taste. In
`office.css` the ellipse under each person is **a status light and a focus ring**:

```css
.actor.is-done  .actor-shadow { /* green  */ }
.actor.is-error .actor-shadow { /* red    */ }
.actor:has(.actor-art:focus-visible) .actor-shadow { /* accent */ }
```

A finished task flashes green under somebody's feet; a failure stays red; keyboard
focus lights up the same shape. **A shadow painted into a PNG can do none of those**
— and a second, baked shadow under the real one reads as two light sources.

It also has to scale with depth (a person further up the floor casts a smaller
ellipse) and it must survive a horizontal flip, which a baked asymmetric blob does
not.

### 7a. ✅ Furniture gets a shadow too — FLOOR only, and by a different mechanism

> **Shipped 06/09** — `Furn` in `renderers/dom/Room.tsx`, one `<radialGradient
> id="office-floor-shadow">` in the room's `<defs>`, referenced by one `<ellipse>` per
> floor object. `rx = widthOf(p) * 0.46` and `ry = rx * 0.24`; the ellipse straddles the
> base line at `cy = baseY - ry * 0.36`, the same 68/32 split the person's has.

| | Shadow | Why |
|---|---|---|
| **Floor furniture** | ✅ a contact ellipse in code | it stands on the floor; without one it looks pasted onto it |
| **Wall objects** | ❌ no floor shadow | they never touch the floor. An ellipse under a window is a window standing on the ground |

🔴 **It is NOT the same mechanism as a person's, and reusing `.actor-shadow` would be
the mistake.** That ellipse is a *status light and a focus ring* that happens to look
like a shadow; furniture has no status and takes no focus, so its shadow is **pure
decoration**. Different job ⇒ different element: a static `<ellipse>` inside the room's
`memo`'d SVG layer, painted once and never re-rendered, next to zero cost.

Two things it must inherit anyway:

- **Width from `widthOf(p)`**, never a constant. A sofa's footprint is three times a
  plant's; one ellipse size for both puts a plant on a raft. Deriving it means the
  shadow cannot drift when a piece is regenerated at a new aspect ratio.
- **The same colour and softness as the person's ellipse.** Two shadow recipes in one
  room is two light sources, and that reads instantly even when nobody can say why.

⚠ And the same ban applies as for characters: **no baked shadow in the art.** A piece
that arrives with one gets a second from the code, under it, slightly offset. If a
future sheet comes back with baked shadows, the *art* is regenerated — the code does
not start special-casing which pieces already have one.

> Wall objects hanging flat with no shadow at all is a deliberate acceptance, not an
> oversight: the alternative is a small offset drop shadow **on the wall**, which is a
> second light-direction decision for the whole room. Not worth opening until the wall
> actually reads as flat in a screenshot.

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

### 🔴 AND THE POOL IS FIVE, NOT TEN — where the twins actually came from

`CAST` is **ten rows** and there are **five sprite strips**. `spriteFor()` wraps
(`cast % 5`), so **character 2 and character 7 are the same drawing**.

Two employees could therefore be dealt different, correct, in-range, *distinct* cast
ids and still stand in the room as identical twins — and every check there was would
have said they were different people. A fairness rule counting `CAST_COUNT` would
have spread ten ids over five faces and looked exactly as broken as the hash.

⇒ `FACE_COUNT` lives in `core/cast.ts`, and **`art/manifest.ts` throws at load** if
its strip count disagrees. A comment saying *"keep these in step"* is not a mechanism;
a throw on the line that loads the room is. Add a sixth strip without raising the
number and the office would quietly go on using five while a drawing sat unused —
which is this bug again, wearing a hat.

⚠ The ten rows stay. `layout.cast` holds 0…9 and the table is append-only; deleting
five rows would silently re-cast everybody who hand-picked above 4.

### ✅ Rule A, shipped as `assignCast()` — deal from the basket

Each person's **hash is still their preference**, so an office where nothing collides
is dealt exactly what the hash always gave it. A clash probes forward to the next free
face; when the basket empties it **refills**, so the sixth employee starts a fresh
round instead of piling onto whoever is left. Measured on eleven people over five
faces: `3/2/2/2/2`, never a heap on the last one.

Two properties the tests hold, both learned the hard way:

- **a hand-picked face takes its seat FIRST**, before any dealing. Otherwise the deal
  could hand somebody the face the user has just claimed for someone else — the twin
  coming back through the one door the user controls.
- **the deal must not depend on the caller's node order.** `layout.nodes` is rewritten
  wholesale by the browser on every canvas drag, so its order is not something to build
  a rule on. `assignCast` sorts the ids itself.

⚠ **Everybody on the diagram counts, resting or not.** A person at the coffee counter
is a face on screen; leaving them out is how two people end up in the same shirt while
an unused face sits in the basket. The assistant is in the same pool for the same
reason.

### 🔴 The cost of NOT storing it, stated rather than discovered

The section above used to say: *pick the least-used character at hire time, write it
into `layout.cast`, never recompute* — because the hash bought *"hiring or firing
somebody never shifts anybody else's face"* and a recomputed counter destroys that.

**That virtue is genuinely gone**, and it was traded knowingly: firing somebody can
change the face of the one person their clash had displaced.

The reason it is not stored is not laziness. The only place that knows the full roster
is `canvas()`, and **`canvas()` is a READ**. A read that writes `layout.json` and emits
`layout.changed` is the silent feedback loop this repository has already paid for once.
A stable face is not worth a write on every poll.

⇒ If this is ever revisited, the write belongs at **hire time**, in the code path that
creates the node — not in the code path that draws it.

⚠ **Count only LIVE nodes.** Including deleted employees makes the counter describe
company *history* rather than the room being looked at; after twenty hires and
nineteen departures it would be permanently skewed for no visible reason. `assignCast`
gets its list from `layout.nodes`, so this holds by construction.

### ⚠ A per-sheet render SCALE, and the measurement that made it a design choice

Three of the five characters read as **short**. The bounding box of the `stand` cell
on all five v3 strips says otherwise:

| c0 | c1 | c2 | c3 | c4 | `BODY_H` |
|---|---|---|---|---|---|
| 689 | 689 | 690 | 689 | 690 | 690 |

So the normaliser did its job and **nothing is mis-scaled**. Three of the five simply
carry more of that height in hair and head, which reads as a shorter person at the
same total height — a **proportion** difference, and no amount of re-cutting would
change it.

### ✅ 07/09 — c1…c4 re-rolled for the sit pose, and the SHEET was the unit

The seated poses were bad on four of the five. New sheets came back (`castN.4.png`)
and the tempting move was the one §2 forbids in capitals: **cut out the new `sit`
cell and paste it into the shipped strip.** It was not taken, and this time the
reasoning is worth separating from §2's, because §2's own measurement does **not**
apply here:

- §2 measured a spliced cell inside the **walk cycle** — a wristwatch blinking 6.5
  times a second at `steps(4)`. The `sit` cell is never in that cycle.
- What *does* still apply is slower and just as real: a person standing and then
  sitting would change hair volume, hem and skin tone between two states seconds
  apart, from two different generations of the same character.

⇒ The four sheets were replaced whole. **c0 was not re-rolled and keeps its v3
strip** — the unit is the sheet, not the cast.

| | v3 `sit/stand` | **v4** |
|---|---|---|
| c0 (untouched) | 0.792 | — |
| c1 | 0.723 | **0.782** |
| c2 | 0.713 | **0.762** |
| c3 | 0.721 | **0.772** |
| c4 | **0.649** | **0.775** |

The correction below is now worth **6 world units at worst instead of 28**, and
`MAX_SIT_LIFT` came down 30 → 12 with it — slack in that ceiling is a chess player
pushed that far forward of the stool they are sitting on.

⚠ **`scripts/cut-cast.ps1` is now in the repository.** It was living in a scratch
folder while `manifest.ts` claimed the file names were "a contract with
`scripts/normalise-art`" — a script that did not exist. A pipeline that only exists
in somebody's temp directory is a pipeline that will be lost the first time the
folder is cleaned, and the three numbers it normalises (standing height, ground
line, hip anchor) are not recoverable by eye. Windows-only and deliberately outside
the product: it runs by hand when art arrives and nothing that ships imports it.

⚠ It **prints `sitH` on every cut**, because that number has to be copied into
`manifest.ts` in the same change. A re-cut without it leaves the seated figure
floating or sunk, silently, and only when somebody happens to be resting.

### 🔴 The `sit` cell is the one cell that has to leave the anchor

Same shape of problem, opposite answer, and this time the measurement **predicted the
user's own ranking before they were shown anything**.

Every strip pins all six cells to the same bottom edge, which is right for standing and
walking — the anchor is the feet. The `sit` cells are pinned there too, and their
figures are **not the same height**:

| c0 | c1 | c2 | c3 | c4 |
|---|---|---|---|---|
| 546 | ~~498~~ 539 | ~~492~~ 525 | ~~497~~ 532 | ~~**448**~~ 535 |

(v3 struck through; v4 measured after the re-roll above.) On v3 a seated c4 was 98
strip-pixels shorter than a seated c0 while both started at the same line, so it
**sank into the seat**. The user reported exactly this, unprompted:
*"characters 2, 3 and 4 a little; 5 is the worst"* — which is c1/c2/c3 a little and c4
the worst, and c0 not mentioned at all. The numbers and the complaint are the same fact.

⇒ `CastSprite.sitH` is the measurement; `sitLiftFor()` derives the lift as the
difference from the tallest, as a fraction of the cell. Three hand-tuned offsets would
have done the same thing and told nobody why — and would have to be re-tuned by whoever
notices, which is nobody.

⚠ **The ground shadow does not move with it.** The lift corrects a *drawing*; the
person is still on the same floor, and a contact ellipse that rises with the body is a
body that hovers.

⚠ The trade, stated: a lifted figure's feet ride a little above the floor line. On a
stool with the seat drawn behind them that reads as sitting; it is why the lift is
capped by a measurement rather than nudged until it looks right.

⇒ `CastSprite.scale`, per sheet, `1.1` on c2/c3/c4. It says *this drawing is rendered
larger, on purpose*, and it goes back to `1` the day those three are redrawn. It
scales the cell from the **feet**, so the anchor is untouched; `--sprite-k` is
inherited by the ground shadow so a bigger person casts a bigger shadow; and
`SpriteFrame` applies it too, or the picker would preview somebody at a size the room
does not draw them at.

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
| c3 · gilet | the **gilet only** | the **blue shirt underneath**, trousers, shoes, hair, glasses, watch, skin |

An inner layer left white is what keeps a tinted outfit reading as an outfit rather
than as a colour swatch with a head on it. Trousers stay dark for the same reason —
two tinted regions on one small figure is a costume, not a person.

### 🔴 c3 · THE SAME CHARACTER FAILED IN v1 AND PASSES IN v3 — measured

The gilet would not take a tint on the v1 art and the cause was in the **drawing**, not
in the mask code. Near-grey pixels (`sat < 14 %`), by luminance band:

| | v1 `cast-3.png` | v3 `4.3.png` |
|---|---|---|
| bands found | **ONE**: lum 60–69, 6 658 px | **TWO**: lum 120–139 and lum 60–79 |
| what that means | gilet **and** trousers are the same lightness | gilet mid, trousers dark, **80–99 empty** |
| separable? | ❌ no window exists that takes one and not the other | ✅ `sat < 14 % ∧ 100 ≤ lum ≤ 150` |
| tint range | ❌ lum ≈ 65 is near-black; `color` keeps luminance, so every tint came back a slightly different dark grey | ✅ lum ≈ 136 gives full hue range |

Auto-derived on v3: **86 357 px over all six cells**, rendered and looked at — the
gilet only, with a few stray pixels on the hair fringe and the watch strap. Five tints
applied, reviewed at both sizes (§0): five clearly different gilets, folds intact,
shirt · trousers · hair · skin · shoes · glasses untouched.

⇒ Two rules, and the second is the general one:

1. **A garment that will not tint is a garment drawn at the wrong lightness.** Reach
   for the art before reaching for a hand-drawn mask.
2. **"The tint looks wrong in the app" and "the tint maths is wrong" are different
   claims.** Here the app was still rendering v1 — it had never been given v3 — so the
   thing on screen was a *different drawing*, not a bad tint. Check which file the app
   actually loads before debugging what it does with it.

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

---

## 12. 🔴 The speech bubble holds 18 characters, ellipsis included

**User's number, 06/09.** `core/office-bubble.ts` · `test/office-bubble.test.ts`.

A `git status` summary came back as **eighteen LINES** of `say`, and the bubble grew
into a white slab covering the window, the whiteboard, the clock and half the floor.
The room stopped being a room.

⚠ **And it sat across the speaker's face.** `bottom: 152px` was a hard number in a
room where a person is `CH_H = 177` tall, so the tail hung 25 units *below* the top of
their head — breaking Rule 1 (§0) with the one element whose whole job is to point at
them. It is `calc(var(--ch-h) * 1.1 * var(--sprite-k, 1))` now: derived from the person
it belongs to, so it follows both a cast resize and a per-character scale (§9).

Wrapping is not the answer and neither is a scrollbar: **the chat panel is already the
surface for reading** — one click away, always in sync. The bubble's whole job is *this
person is saying something*, and that survives eighteen characters.

Four things the implementation gets right, each of which can break silently:

| | Why it is not optional |
|---|---|
| **the ellipsis is INSIDE the budget** | a cap that appends its marker to the limit is not a cap; it is the limit plus whatever the marker costs, and nobody notices until somebody writes `...` and it becomes three |
| **counted in CODE POINTS** | a tone mark is its own code point in NFD and an emoji is a surrogate pair; `String.slice` cuts inside both |
| **whitespace collapsed BEFORE the cut** | capping after the collapse is what stops eighteen characters from still being four lines tall |
| **the glyph is inside the budget** | `DomScene` composes `"<glyph> <say>"` and clips the **whole** string, so a place marker eats into the message rather than widening the box |

⚠ **Nothing is lost.** `ActorView.say` still carries the full sentence: it is the actor
button's accessible name, and the same text is in the chat. Clipping in the store
instead would have taken the sentence away from the one reader who cannot see the
picture at all. The clip happens **where it is drawn**, and the helper lives in `core/`
so a second renderer cannot invent a second rule — and so a test can reach it.

---

## 13. ⚠ A delivered sheet can carry an ISLAND, and it is invisible in review

Found 06/09 on `table-low.png`: a **60-pixel opaque island** at `[145,0]…[150,11]`,
disconnected from the table by transparent pixels. In the room it rendered as a small
dark speck floating beside the sofa's right foot — the kind of thing that reads as a
rendering glitch rather than as an art defect, so it gets debugged in the wrong file.

It is a leftover from the segmenter §3 already describes: the delivered floor sheet had
objects touching at a zero-pixel gap, and the waist-cut that separated them left a
fragment of a neighbour behind. **The `SEPARATION` line in block A is what prevents
this, and it was added after that sheet was cut.**

⇒ **On delivery, count the ISLANDS, not just the cells.** A flood-fill over alpha ≥ 24
reports every connected component per file; a healthy piece has exactly **one**, and the
whole set takes seconds. This is the measurement that was missing from §6 — cell height,
body height and centring all passed on a file carrying a stray blob, because none of
them asks *"is this one object?"*.

⚠ And when a stray is erased rather than regenerated: **do the no-op round trip first.**
A canvas re-encode goes through premultiplied alpha, and this art carries partial alpha
on 40% of its pixels. Decode → re-encode with no edit → compare every channel; only
write if the worst delta is **0**. Measured 0 here, so the file kept its exact pixels
and its 151×127 canvas — which matters because `ar` and `h` in `art/furniture.ts` are
measured off that canvas, and re-cropping would have silently resized the table.
