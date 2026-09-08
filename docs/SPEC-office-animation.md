# SPEC — The office view: the same office, drawn as a room

**Date:** 2026-09-05 · **Status:** design settled, not built
**Read alongside:** `SPEC-canvas.md` (the shape this view re-draws) · `SPEC-ui.md` §5
(the event set) · `SPEC-offices.md` §6 (what an event is allowed to claim) ·
`SPEC-token-economy.md` (the law: **no LLM turn may exist to power a display**).

---

## 0. This REVERSES one line, and the reversal has a price

`SPEC-canvas.md` §8 reads:

> Drawing characters / character animation — **deliberately not doing this**.
> Nodes are enough, and far cheaper.

That was correct for the audience it was written for: someone who already reads
diagrams. It is wrong for the audience the product actually committed to — the
flower-shop owner of `SPEC-offices.md` §6c, who opens the app and gets a graph of
rounded rectangles with a pulsing border.

**What changes it:** the diagram answers *"what is my company made of"*. It does
not answer *"what is happening right now"* in a form a non-technical owner reads
without being taught. The log answers that and nobody reads a log.

**The price, stated up front so nobody discovers it later:**

| | |
|---|---|
| Three **additive** backend fields | §6. All three stop throwing away a classification the code already computes. No prompt changes, no new event type, no new decision. |
| ~1,200 lines of view code | one scene, one character function, one loop. No dependency added. |
| A second surface that can **lie** | a diagram that draws a wire is stating a fact from `layout.json`. A room that walks a character to the bookshelf is stating *"this worker read a document"* — and if that is inferred rather than observed, the picture is a false claim wearing an animation. §6 is the whole answer to this, and it is the most important section in the file. |

The diagram is **not** replaced. It stays the editing surface; the room is a
second **view** of the same state. → §11.

---

## 1. What this view is for, in one sentence each

| Question | Diagram answers | Room answers |
|---|---|---|
| what is my company made of | ✅ nodes | partially (who is standing there) |
| who is working right now | a border pulses | **a person is doing something, somewhere** |
| what are they touching | ⛔ nothing | **the object they walked to** |
| who is idle | the word *"resting"* | **they are at the coffee table** |
| how do I change it | ✅ drag, wire, delete | ⛔ **not here** — §10 |

The last row is the design. Two surfaces, one editable. A room where you can also
rewire the company is a second write path into `layout.json`, and this repository
has already paid for that mistake twice (the `- [ ]` checkbox that must not be
clickable, `SPEC-ui.md` §3.2; `skillFileFor`, `SPEC-offices.md` §5.1).

---

## 2. Style: continuous line + flat fill. **Not pixel art.**

The user's preference settles the aesthetic. The engineering agrees, and the
reason is worth writing down because "pixel art is retro and cheap" is the
intuition and it is **backwards here**:

| | pixel art | line + flat fill |
|---|---|---|
| what a character IS | a raster sheet: N poses × M directions × K characters, shipped as PNG | ~25 SVG path commands, a few hundred bytes, generated from a parameter row |
| 10 characters | 10 sheets to draw, ship, decode, and hold in texture memory | **10 rows in a table**, one drawing function |
| the canvas already zooms 0.35× – 2× | needs `image-rendering: pixelated` **and** integer zoom steps, or it turns to mush — i.e. it fights the zoom the product already has | scales for free, it is vector |
| theme (light/dark) | baked into the pixels ⇒ two sheets, or a shader | `currentColor` + CSS variables, already how `ArmIcon` works |
| RAM | texture memory that never goes away | none beyond the DOM |
| changing a colour | re-export the asset | change a token |

Line + flat fill is also the language the app already speaks: `NodeShape` is
SVG paths, `ArmIcon` paints with `currentColor`, `canvas.css` puts state on a
class and never touches a style from JS. The room is **not a new rendering
world**; it is the same one with different shapes in it.

**Concrete style rules** (so ten characters look like one cast, not ten
downloads) — the full standard is §2b:

- one stroke weight everywhere: **1.75px at 1× scale**, `stroke-linecap: round`,
  `stroke-linejoin: round`
- fills are **flat** — no gradient, no shadow inside a character. Exactly one
  soft drop-shadow in the whole scene: an ellipse under each character, so people
  stand on the floor instead of floating
- outlines use `--color-ink`, at 85% opacity for furniture so people read as
  foreground without a second colour system
- the palette is the app's existing tokens plus **one array of 10 garment
  colours** (`--cast-1` … `--cast-10`), defined once for light and once for dark
- **~5.3 heads tall, 133 world units** — see §2a, which is the correction that
  had to be paid for.

### 2a. 🔴 The first cut was rejected on sight. Three mistakes, and none was "not a framework"

Shipped, looked at, and the verdict was one word. Worth writing down because the
instinct afterwards ("we need a proper engine / an asset pack") points at none of
the actual causes:

| what was wrong | why it looked the way it did |
|---|---|
| **2.6 heads tall** | that is *chibi* — a blob with a face. The reference everyone actually pictures is the standard animation figure at **5–6 heads**, where **the legs are roughly half the total height**. That single ratio is most of what separates "a character" from "a snowman", and no amount of detail rescues the wrong one |
| **no contour line** | flat fills alone read as clip-art. The same shapes with a **stroke around every solid part** read as drawn. One CSS declaration |
| **rounded rectangles** | a head is an egg with a chin, a torso tapers from shoulder to waist, a leg has a knee. Each of those is one extra control point, not a redesign |

And a fourth, which was a **scene** error rather than a drawing one:

> **The room had to grow with them.** A 70-unit person in a 1600-unit room is
> twenty-three people wide — a warehouse. At 133 the room reads as a room, and a
> 25-unit head is big enough for eyes that land. Character size and furniture
> size are one decision, not two.

**The corrected grid** (`Character.tsx`; every number is a constant, none is
typed twice):

| | value | |
|---|---:|---|
| total height | **133** | ≈ 5.3 heads |
| head | 25 | egg with a chin, half-width 9 |
| shoulder → waist | 29 | half-width 15 → 12 |
| hip → floor | **58** | **44% of height** — the ratio that reads as an adult |
| knee | at −30 | |
| eye line | at −121 | tall eyes, `rx 2.3 / ry 3.2`, with a white highlight |
| contour | 1.4px, `non-scaling-stroke` | one weight for the whole cast |

### 2a′. Volume: shading is a GRADIENT, not a hand-drawn shadow

*"2D is fine, but it has to look like something."* Correct, and the cheap way is
the right way here.

- **Two `linearGradient`s in `objectBoundingBox` units, reused by every part**
  (`#chShade`, `#chLight`), plus a `radialGradient` for the ground shadow. Each
  part is painted three times with the same geometry: fill, shade, highlight.
- **The light is fixed at the upper left and never moves.** A scene where parts
  are lit from different sides reads as wrong without a viewer being able to say
  why.
- ⚠ **No filters.** `feGaussianBlur` / `feDropShadow` are the expensive ones —
  each forces an offscreen buffer per element, on every frame that element moves.
  A soft shadow is a radial gradient; it costs nothing.
- Hand-authoring a shadow shape per volume would be ten characters × six parts of
  drawing, and every one of them a chance for the tenth to stop matching the
  first. **The gradients are the same for everyone by construction.**

### 2c. 🔴 THE ART IS A PLUG-IN — and this reverses part of §3a

The redraw in §2a was still rejected: *"soulless — go find a framework."* The
verdict is right, and so is half the instruction. **What was wrong in §3a:**

> *"A game framework gives you a RUNTIME, not a STYLE."*
> True of **Phaser / Pixi** — they are draw loops and nothing else. **False of
> Lottie and Rive**, because those come with an **asset shelf attached**. What
> you get from them is not a loop; it is *a real animator's drawing*. Lumping
> all four into one bucket was the mistake.

**What was researched, 05/09:**

| | |
|---|---|
| a Claude Code **skill** that draws characters | none exists |
| **Lottie** (`lottie-web`) | ~60 KB gz runtime, MIT. The shelf is large and covered by **one blanket licence** — the Lottie Simple License: commercial use cleared, **no attribution required** |
| **Rive** (`@rive-app/canvas`) | technically better — small files, state machines, canvas-native. But the free shelf is **thin** and licences are **per creator**, which is the wrong risk for a repository going public |
| **Open Peeps · Humaaans** | genuinely CC0 and genuinely good, but a flat editorial style — adopting them means changing what the product looks like in order to avoid drawing |
| "free monster-collecting style" packs | ⛔ many are themselves derivative; the uploader had no right to grant |

⇒ **Lottie**, and the room is built so that this is a **one-file decision**.

#### The socket: `office/art/manifest.ts`

```
ART = null      → the room draws its own characters, and lottie-web is NEVER FETCHED
ART = {…}       → the same room plays that file instead
```

Nothing else in the office view knows which is running. **The loop moves a BOX;
what is inside the box is one file's business.** That seam was built first, on
purpose — it is why swapping the art costs one file rather than a rewrite, and
why the work in §5–§9 survived the verdict intact.

The manifest **requires** `licence` and `source`. Free LottieFiles animations
carry a **share-alike clause** — a modified file is a derivative work and must be
distributed under the same terms — and this repository ships under FSL, so the
asset keeps its own licence and travels with the text of it. Making the fields
required means provenance is answered *when the asset arrives*, not during a
licence review two years later.

#### Three constraints that come with it, stated before anyone is surprised

| | |
|---|---|
| **CPU** | `lottie-web` is main-thread and CPU-bound, and its SVG renderer mutates hundreds of DOM nodes **per frame per character**. Hence: the **canvas** renderer (what the library's own docs point at for many animations at once), the **light** build, and — the real lever — **it does not run while somebody is standing still**. Standing holds a frame; walking plays. Leg G of test 23 must be re-measured, not assumed |
| **One asset = ONE character** | ten people drawn from one file are the same person ten times. `hue` in the manifest rotates them apart, and ⚠ it shifts the **skin** too, so the range wants to stay narrow. Absent ⇒ everybody identical, told apart by the name over their head — honest, and exactly what the diagram already does |
| **A re-render per trip** | the built-in drawing walks from a CSS class and React never hears about it, which is what keeps an idle office at zero renders. A Lottie file must be **told** which clip to play, so `Stage.onWalk` is wired **only when `ART` is set**. Turning it on unconditionally would make the cheap path pay for a feature it does not use |

#### The consequence for the scene: two layers

A Lottie player mounts a `<canvas>` into a DOM node, and reaching that from
inside an `<svg>` means `foreignObject` — already banned here for the speech
bubbles, for the same reason. So:

- **the room stays SVG.** It never moves, so it costs nothing after the first
  paint, and vector furniture scales for free.
- **the people become an HTML layer** sitting exactly on top of it. `fit()`
  gives that layer precisely the transform `preserveAspectRatio="xMidYMid meet"`
  applies to the svg, so one world coordinate lands on the same pixel in both
  and the movement loop still writes plain world units.

Two things fall out for free: the bubbles get **real text layout** (the width is
no longer estimated from a character count), and each actor becomes a real
focusable button.

⚠ `lottie_light_canvas` is emitted as a chunk on disk even with `ART = null`,
because the `import()` is reachable from the module graph. It is **never
fetched** — the branch that runs it only exists when an asset does.

### 2b. 🔴 What keeps hand-drawn art from drifting — and it is NOT a framework

The fear is legitimate and worth answering precisely, because the instinct points
at the wrong tool:

> **A game framework gives you a RUNTIME, not a STYLE.** Phaser and Pixi supply a
> loop, a scene graph, sprite batching, input. Not one of them makes a character
> look professional or keeps ten of them consistent. Studios using Pixi still hire
> an illustrator and still write a style guide. Adopting an engine to fix a
> drawing problem buys a megabyte and fixes nothing.
>
> ⚠ **This sentence was over-applied once, and §2c is the correction.** It is
> true of a draw loop and **false of Lottie/Rive**, whose whole point is the
> asset shelf. The section below is about engines; the art decision is §2c.

What actually prevents drift is a **drawing standard**. Four mechanisms, and the
first one is doing most of the work:

**① There is only ONE drawing.** All ten characters come out of a single
`Character()` function reading a parameter row (§4). Ten characters cannot drift
apart, because there are not ten drawings — there is one drawing and ten
configurations. Drift is a disease of *independent assets*, and this design has
none. (This is the same argument the repo already makes about `slugId` being the
one definition of "duplicate", and about `fitSay` being reused rather than
re-implemented: two copies of one thing drift, one copy cannot.)

**② A construction grid, in numbers, not by eye.** The table is in §2a. Every
part reads those constants; not one measurement is typed twice, so a new hair
shape lands where every other hair shape lands.

⚠ Same rule as the comment boxes in `docs/CLAUDE.md`: **do not align by eye.** A
part drawn "about right" is exactly how the tenth character stops matching the
first.

**③ Borrow a standard we already ship.** The app already uses **lucide** icons:
24-unit grid, 2px stroke, round caps and joins, no fills. Drawing the furniture
and the character outlines to those same conventions makes the room look like it
belongs to the rest of the interface rather than like a second product bolted on
— and it costs nothing, because it is a convention, not a dependency.

**④ A contact sheet, so drift is VISIBLE rather than argued.** A dev-only route
(`/__cast`, not shipped in the production bundle) rendering **all 10 characters ×
3 poses × light and dark, on one screen**. It is the same component in a loop, so
it costs an afternoon once, and it is the "standard to check against" the whole
worry is asking for: the tenth character sitting beside the first is the only
review that catches a proportion that slipped.

**Motion has a standard too**, and it is a small table rather than a feeling:

| | duration | curve |
|---|---|---|
| turning (`scaleX` flip) | 120 ms | `ease-out` |
| bubble appear / clear | 160 ms | `ease-out` |
| receipt / briefing token | 600 ms | `ease-in-out` |
| scene pan when the sidebar overlays | 200 ms | `ease-out` |
| reduced-motion cross-fade | 250 ms | `linear` |
| walk | **distance ÷ 60 u/s** — a duration is never hard-coded, or a short trip looks like a lunge | linear, with a 150 ms ease at each end |

**③′ What was checked, and what it is worth.** Researched 05/09, since the
question *"is there a set that draws better"* deserves an answer rather than a
preference:

| | |
|---|---|
| a Claude Code **skill** that draws characters | **none exists.** The available set covers design canvases, data visualisation and artifact/document work — nothing that produces character art |
| **Open Peeps** · **Humaaans** (Pablo Stanley) | genuinely **CC0**, genuinely good, mix-and-match SVG. But the style is flat western editorial illustration, **not** the animation style asked for — adopting them means changing what the product looks like to get out of drawing it |
| CC0 **anime-ish vector** packs (itch.io / OpenGameArt) | they exist, and they are **fantasy game sprites** — horns, wings, weapons — not ten office workers. Consistency across a cast is exactly what they do not give |
| "free monster-collecting style" packs | ⛔ **the trap.** Many are themselves derivative; the uploader had no right to grant. A clean-looking licence on a traced asset grants nothing |

⇒ The conclusion the fence in §3b already reached, now with the alternatives
actually examined: **draw it.** The one option worth keeping in the back pocket
is Open Peeps/Humaaans, and only if the whole product ever moves to that style
deliberately.

**And the honest admission.** None of this promises *beautiful* — it promises
**consistent** and, more importantly, **cheap to redo**. If the art turns out
amateurish, the fix is one function's paths, not ten purchased assets you cannot
edit. That is also the point where money buys the most later: commission one
illustrator to redraw `Character()`'s paths to the grid above, keep every
parameter row, and the whole cast improves in one commit. A sprite pack cannot be
upgraded that way — you re-buy, or you live with it.

---

## 3. Framework: none. And the copyright question, answered properly

### 3a. No game engine — ⚠ and read §2c, which narrows this

**Phaser, PixiJS, three.js** are rejected. **Lottie and Rive are not** — they are
a different kind of thing and §2c settles that separately. The four arguments
below are about *draw loops*, and none of them applies to a player that arrives
with an asset shelf attached:

1. **Each owns its own render loop and its own `<canvas>`.** The app's hard
   performance rule (`SPEC-ui.md` §0) is *"React owns the shell; the canvas owns
   its own mouse loop, and one SSE event must not re-render the tree"*. A second
   engine means a second loop with its own scheduling, composited over a React
   tree — and every click has to be re-plumbed back out of the engine into the
   store to open a panel (§10).
2. **Bundle.** Phaser is ~1 MB gzipped, Pixi ~300 KB. The whole existing web
   bundle is smaller than either. *"Light on RAM, kind to the browser"* is the
   request; adding a WebGL context to draw eight stick figures is the opposite.
3. **They do not solve the actual hard part.** The hard part is §6 — knowing
   truthfully where a worker is. An engine has no opinion about that.
4. It would be the first dependency in the repo that cannot be read in an
   afternoon. `SPEC-canvas.md` §7 already chose *"SVG + vanilla JS, no canvas
   library"* for the diagram; the room inherits it.

### 3b. Copyright — where the line actually is

The ask is *"characters that behave like the ones in the monster-collecting RPGs"*
— the well-known franchise, named here only as a reference point. Splitting that
into the two halves that matter legally:

| | protected? | |
|---|---|---|
| **A specific character** — its design, name, silhouette, colour scheme | ✅ copyright **and** trademark | Ash/Satoshi, Misty/Kasumi, Brock/Takeshi, Prof. Oak are all off limits, including "inspired by" redraws that keep the identifying combination |
| **A genre convention** — small standing figure, oversized head, flat cel colours, a cap, a lab coat, a ponytail, a walk cycle of four poses | ❌ not protectable | style and technique are not owned by anyone |
| **A third-party sprite pack** | depends entirely on its licence, and **many free "monster-collecting style" packs are themselves derivative** — the uploader had no right to grant | this is the trap: a clean-looking CC0 asset that is a traced edit gives you nothing |

**The rule this repository adopts, and it is a hard one:**

> **Zero third-party character assets. Every character is an SVG path written in
> this repo.** There is then no licence to comply with, no attribution file to
> maintain, and no asset whose provenance we cannot answer for.

**The fence, stated so it is checkable rather than a feeling:** no cast member may
carry *a name + a silhouette + a colour scheme* that together point at one
existing character. Individually generic elements are fine and unavoidable — a cap
is a cap. What is forbidden is the **combination that identifies**: the
red-and-white cap with a blue jacket and green fingerless gloves; the orange side
ponytail with a yellow crop top and red suspenders; the spiky brown hair with
squinting eyes and an orange vest. The cast in §4 is built from **office
archetypes**, not from an existing roster, precisely so this fence never has to be
argued at review time.

⚠ **Names.** Cast members get **no names of their own**. The name over a
character's head is the employee's name — the one the *user* typed when they
created that employee. A cast with its own names would (a) need a catalogue entry
per language, and (b) create exactly the identity a fence is trying to avoid.

---

## 4. The cast — 10 characters, one drawing function

A character is **a row of parameters**, not a drawing:

```ts
interface CastMember {
  id: number;               // 0..9, stable forever — it is what gets persisted
  hair: HairId;             // short · bob · ponytail · bun · long · buzz · curly · braids
  headwear: HeadwearId;     // none · cap · beanie · headband · glasses-on-head
  accessory: AccessoryId;   // none · glasses · scarf · badge · earbuds · satchel
  garment: 1..10;           // index into the --cast-N token array
  skin: 1..5;               // index into the --skin-N token array
}
```

Ten rows, one `<Character>` function that reads a row and emits paths. Adding an
eleventh character is **one row**, not one asset. The combinatorial space is
8 × 5 × 6 × 10 × 5 = 12,000, so "ten" is a curation decision, never a ceiling.

**Poses.** Three body drawings, no more:

| pose | when | how |
|---|---|---|
| `front` | standing still, facing the viewer | the base drawing |
| `side` | walking, and standing at a station | the same body, face in profile; the other direction is `scaleX(-1)` — **not** a second drawing |
| `sit` | break area only | legs bent, the rest identical |

`back` is deliberately absent: a character with no face is unreadable at 72 units
tall, and the room is arranged so nobody ever needs to turn away from the viewer.
(→ §5, the stations sit along the back and side walls for exactly this reason.)

**The walk cycle costs no JavaScript.** Arms and legs are their own `<g>`
elements with a CSS `@keyframes` rotation; the class `is-walking` turns it on.
Blinking is a second keyframe on the eyes, with a per-character `animation-delay`
derived from `id`, so eight people do not blink in unison. **JS computes position
only** — everything limb-shaped is style.

### 4a. Casting: deterministic by default, overridable by hand

| | |
|---|---|
| **default** | `castOf(officeId, roleId) = hash(officeId + ':' + roleId) % 10`. Zero storage, zero backend, stable across restarts and machines. A brand-new office already has a cast. |
| **the assistant** | same function with the literal `'assistant'`, so it is cast like everyone else and cannot collide by accident with a worker in the same office — collisions **are allowed** across offices and do not matter |
| **override** | the user picks a different character from the Inspector. Stored per office → §6c |

⚠ **Why the override must NOT live in `roles/<id>.yaml`.** That file feeds
`cacheKey` (`SPEC-canvas.md` §2). Changing a costume would throw away that
agent's prompt cache and pay a ~20K `cache_write` for a haircut. This is the
exact bug the shape/content split exists to make impossible, and the room must
not be the thing that re-opens it.

---

## 5. The room

### 5a. Floor plan

A fixed world, **1600 × 900 units**, drawn into one `<svg viewBox="0 0 1600 900"
preserveAspectRatio="xMidYMid meet">`. No pan, no zoom, no scroll: the room
always fits the frame, the browser does the scaling, and there is no viewport
state to persist or get lost in.

```
 ┌───────────────────────────────────────────────────────────────────────┐
 │  ▤▤▤ BOOKSHELF                                      ▦ ARM BENCH  ▦    │  back wall
 │  (Document library)                            (the high-tech laptop) │
 │        ·ring·                                          ·ring·         │
 │                                                                       │
 │                                   ▭▭▭▭ FILING DESK                    │
 │      ○ ○ ○   the floor: workers' own spots        (Results/artifacts) │
 │       (a loose arc, seeded jitter — never a grid)      ·ring·         │
 │                                                                       │
 │                    ★ ASSISTANT                        ╔═ BREAK AREA ═╗│
 │              (centre-front, faces the viewer)         ║ ☕  ⛃  🎮  ⚽ ║│
 │                                                       ╚══════════════╝│
 └───────────────────────────────────────────────────────────────────────┘
                                                              front (viewer)
```

**Why this arrangement, station by station:**

| station | where | why there |
|---|---|---|
| **Bookshelf** = the document library | back-left | the least dynamic station, and the left edge is what the sidebar overlays (§11b) |
| **Arm bench** = the MCP/arm laptop | back-right | it is the only station that reaches **outside** the office; putting it against the back wall, farthest from the viewer, matches that |
| **Filing desk** = artifacts/results | mid-right, **within a short walk of the assistant** | this is the answer to the user's own worry, §7d |
| **Assistant** | centre-front, facing the viewer | its counterpart is the **user**, not the workers. Architecturally true: the assistant hands out work and reports back; it never converses with a worker (`SPEC-canvas.md` §3) |
| **Break area** | front-right, the only place with chairs | §9 |
| **Shared knowledge** | **not drawn** | the user's call, and it agrees with the diagram: the knowledge store has no wires because it is *the environment, not a relationship* (`SPEC-canvas.md` §4). A shelf nobody ever walks to would teach the opposite |

### 5a′. 🔴 THE ROOM IS NEVER EMPTY — furniture and the assistant always exist

A brand-new office with zero employees still renders a **complete room**: all five
stations drawn, and **the assistant standing at centre-front**. This is not
decoration and it is not a fallback:

- **The assistant is guaranteed by the architecture**, not by luck. Every office
  gets exactly one, auto-created, and it cannot be deleted (`SPEC-offices.md` §4).
  So there is no state of this product in which the room has nobody in it.
- **The furniture is guaranteed too.** The bookshelf, the filing desk and the
  break area exist for every office by definition — they are the library, the
  artifacts directory and the resting state, all three of which exist from the
  moment the folder does. Only the **arm bench** is conditional: no connection
  plugged in ⇒ it is drawn **dimmed with a dashed outline**, the same vocabulary
  the diagram already uses for "nothing is wired here", and clicking it opens the
  Connect dialog.

⚠ **What is forbidden is an "empty state screen" replacing the room.** That was
the mistake already paid for once — `App.tsx` used to replace the whole working
area when there were no offices, and it took spending, connections and workspaces
away with it (bug 02/09). The room with an assistant standing alone in it **is**
the empty state: it says *"this is your office, there is nobody in it yet"* far
better than a centred paragraph does. The invitation to hire the first person sits
as a hint near the assistant, and the button it points at lives in the diagram
view (§10 — the room does not edit).

**Everyone stands.** Chairs exist only in the break area. This is not decoration:
a standing figure has one silhouette and reads at a glance; a room of seated
figures at desks reads as *"an office"* and stops distinguishing busy from idle,
which is the one thing this view is for.

### 5b. Stations are RINGS, not doors

Each station carries a ring of **4–6 standing slots** around it (in front, both
sides — never behind, so nobody turns their back). Arriving means: *take the free
slot on the ring nearest to where I am standing right now*. Consequences, all
wanted:

- two workers at the same station never overlap, and the second one does not queue
  behind the first
- approach direction varies with where the walker came from, so the same trip
  never looks identically choreographed twice
- if every slot is taken (more than 6 at one station — not reachable in practice),
  the walker stops **at the ring's edge** rather than snapping into a taken slot

---

## 6. 🔴 THE SIGNAL PROBLEM — the section that decides whether this view is honest

Everything else in this file is drawing. This is the part that can make the
drawing lie.

### 6a. What is on the wire today

| the interface knows, deterministically | from |
|---|---|
| this worker started / is progressing / finished | `task.started` · `task.progress` · `task.done`, all carrying `role` |
| this worker's current status sentence | `say` — **mixed provenance**, see 6b |
| the files a task produced | `task.done.artifacts[]` |
| the assistant is thinking / planning; how many workers, queued, jobs | `office.activity` |
| the assistant spoke to the user | `master.message` with `role: 'assistant'` |
| an employee answered the user directly | `master.message` with `role: <employee id>` (`deliver: reply`) |
| plan steps and their status | `plan.created` · `plan.step` · `plan.finished` |
| who is wired, who is resting | `canvas.edges` · `node.connected` |

| the interface CANNOT know | why it matters here |
|---|---|
| **which object a worker is touching right now** | it is the entire premise of the room. Without it the bookshelf and the arm bench are furniture nobody ever walks to |
| **a worker speaking to the assistant** | the user spotted this: there is no such log line. §6d |
| the assistant's hidden worker reading a document vs. searching the web | `lookup` (`SPEC-offices.md` §6c) already distinguishes these — in a localized sentence |

### 6b. ⛔ The forbidden shortcut: reading `say`

The tempting fix is to match `say` against something and pick a station. It is
forbidden, on three separate grounds, any one of which is sufficient:

1. **`say` has two different authors.** When the worker's stream contains a
   `tool_use` block, `say` is `describeCall()` — a sentence **we** built. With no
   tool call in that message, it is the model's own prose. One string, two
   provenances, no marker distinguishing them.
2. **`say` is localized.** `describeCall` returns `t('wk.doingReadFile', …)`. A
   rule that matches it works in whatever language was open while it was written
   and silently stops working in every other. This is `docs/CLAUDE.md`'s recurring
   failure class: a rule that cannot see the thing it governs.
3. **The interface never scans text.** Already law for clickable paths
   (`SPEC-ui.md` §"Result paths in chat are CLICKABLE — but only paths CODE placed
   there"), for exactly this reason: a sentence the model produced would borrow
   the interface's authority. Walking a character to the bookshelf is a stronger
   claim than underlining a path, not a weaker one.

> **A wrong station is not a cosmetic bug.** It is the animation stating *"your
> employee read your documents"* when it never opened one — the same failure class
> as a markdown table rendered with the columns misaligned (`SPEC-ui.md` §"Markdown
> tables"). Ugly-but-honest beats smooth-but-invented, every time.

### 6c. The three additive backend changes

All three share one shape, and it is the shape `worker.ts §landingOf` already
argued for itself:

> *"we ALREADY READ every `tool_use` block in the stream to build the 'what's
> happening' line — just throwing it away after composing the sentence. A tool
> that got called is an OBSERVED FACT, not a claim."*

Nothing below infers anything new. Each one **keeps a classification the code has
already made** instead of flattening it into a string and discarding it.

---

**① `task.progress` gains `at` and `arm`.**

```ts
| { type: 'task.progress'; task_id: string; role: string; say: string;
    /** WHERE the tool call landed. Computed beside the sentence, from the same ToolCall. */
    at?: 'desk' | 'library' | 'artifacts' | 'knowledge' | 'arm' | 'web' | 'shell';
    /** The arm's server id, when `at === 'arm'`. Which laptop, not just "a laptop". */
    arm?: string }
```

Where it comes from — all of it exists:

| `at` | the classifier that already runs |
|---|---|
| `library` · `artifacts` · `knowledge` · `desk` | `roomOf()` in `worker.ts` — it already maps a path to exactly these rooms, for the status sentence |
| `arm` + `arm: <server>` | `splitArmTool()` in `audit.ts`, already called on every call to write the audit log |
| `web` | `WebSearch` · `WebFetch` — already their own `case` in `describeCall` |
| `shell` | `EXTERNAL_TOOLS` — already its own branch in `landingOf` |

**The change:** `describeCall(call)` returns `{ say, at, arm }` instead of a bare
string (or a sibling `placeOf(call)` is added next to it — implementer's choice,
same source), `WorkerDeps.onProgress(say)` becomes `onProgress(say, place?)`, and
`scheduler.ts` puts the two optional fields on the event it already emits. Both
fields are **optional**: an older client, the Telegram bridge, and the CLI are all
unaffected, and a `task.progress` with no tool call carries neither.

**Cost:** 0 tokens, 0 prompt text, 0 new events, 0 new decisions. It changes what
is *reported*, never what is *done*.

**And it gets the user's own correction right for free:** *a worker with an arm
plugged in does not necessarily go to the arm.* The trip is drawn on a **call that
happened**, never on a wire that exists. Wired = capability; `at: 'arm'` = event.
The room draws only the second. (Same distinction the notes already carry as
*"absence is not a signal"* — and here, so is presence.)

---

**② `office.activity` gains `reading`.**

```ts
| { type: 'office.activity'; assistant: 'idle' | 'thinking' | 'planning'; …
    /** The hidden worker is running. `library` = reading named documents · `web` = searching. */
    reading?: 'library' | 'web' }
```

`office.ts` already holds this at the call site: `this.reading = readingNote(ok)`
and `ok.length` is exactly the branch. Today it becomes a localized sentence in
`note` and the *kind* is lost.

This is what makes the user's *"the hidden worker — which is the assistant — walks
to the bookshelf"* drawable. Without it, the assistant would have to be walked on
the presence of a `note`, i.e. on a string again.

⚠ **A fourth value on `assistant` was considered and rejected.** `assistant:
'reading'` would change the sentence the existing status line builds for a case
that already has a `note` overriding it — a display regression, paid for nothing.
A separate optional field touches no existing branch.

---

**③ `layout.json` gains `cast`.**

```json
{ "version": 1, "nodes": […], "edges": […],
  "cast": { "assistant": 3, "agent:writer": 7 } }
```

Pure view state, in the file that is defined as pure view state — delete it and
the office runs identically, it just re-casts from the hash (§4a). It rides on the
`PUT /api/layout` the canvas already performs.

⚠ **`readRaw()` currently rebuilds `{version, nodes, edges}` and would silently
drop an unknown field.** So this is not "just write it": `readRaw`, `writeRaw`,
`save()` and `dropAgent()` must all carry `cast` through, and `dropAgent` must
**delete that node's entry** — otherwise deleting an employee and creating another
with the same name inherits a costume nobody chose. (Same shape as the ledger bug
in `SPEC-offices.md` §3b: an id that can come back.)

### 6d. The worker → assistant message that does not exist — and what to draw instead

The user is right, and the reason is architectural, not an oversight:

> **There is no worker→assistant conversation to draw, because the architecture
> forbids one.** Agents never talk to agents (`SPEC-canvas.md` §3, and it is an
> economic law, not a style rule). The only channel from a worker to the assistant
> is the **receipt**, and the only part of it the assistant ever sees is one
> sentence, at one moment: `task.done`.

So the honest drawing is not a stream; it is **one beat, at the moment it really
happens**:

```
task.done  ──►  ① if artifacts.length > 0: the worker walks to the FILING DESK
                   and places a sheet on it (the desk's stack grows by one)
                ② the worker turns toward the assistant
                ③ a small receipt token travels worker → assistant, ~600ms
                ④ the assistant's bubble shows the receipt `say`
                ⑤ the worker is released → §9
```

With `artifacts.length === 0` (a `deliver: reply` task, or a lookup-shaped run),
step ① is skipped and the worker hands off from where it stands.

**The assistant never walks.** This is a deliberate deviation from the user's
sketch of *"whoever hits send walks over"*, and the reason is parallelism: the
very first test in `TEST-WALKTHROUGH.md` expects **three workers starting at
once**, and an assistant that walks would have to be in three places. So the rule
splits by role:

| | walks | turns + sends a token |
|---|---|---|
| worker | ✅ | on hand-off |
| **assistant** | ⛔ never leaves centre-front | ✅ on `task.started` (briefing out) and `task.done` (receipt in) |

And it solves the user's placement worry without parking the assistant somewhere
odd: the **filing desk sits within a short walk of the assistant** (§5a), so the
hand-off beat is short, legible, and lands where the user is already looking.

### 6e. The complete event → animation table

| event | who | what the room does |
|---|---|---|
| `plan.created` | assistant | faces the viewer, plan bubble `…`, the plan strip is already on screen |
| `task.started` | assistant + worker | assistant turns toward the worker, briefing token flies out; the worker leaves the break area (if it was there) and walks to **its own spot** |
| `task.progress` **with `at`** | worker | walks to that station's ring · `desk`/`knowledge` → stays at its own spot · `web`/`shell` → stays put, bubble carries a  / `>_` glyph (§7c) |
| `task.progress` **without `at`** | worker | **does not move.** Bubble text updates only. Absence of a place is not a place |
| `task.done` `status: done` | worker | the hand-off beat, §6d. Character flashes ✓ for ~1.2 s |
| `task.done` `status: failed`/`blocked` | worker | hand-off beat **without** the desk trip; a ⚠ marker, the bubble holds the reason and does **not** auto-clear |
| `task.blocked` | worker | stops where it is, ⏸ marker, bubble stays |
| `plan.finished` | assistant | faces the viewer; report bubble (the `master.message` that already arrived) |
| `master.message` role `assistant` | assistant | speech bubble, faces the viewer |
| `master.message` role = an employee | that employee | **that employee** gets the bubble, not the assistant. This is `deliver: reply` and it is a real, visible difference between the two delivery shapes |
| `office.activity.assistant: 'thinking'`/`'planning'` | assistant | thought bubble `…`, no walking |
| `office.activity.reading: 'library'` | assistant | **walks to the bookshelf**, reads, returns to centre-front when it clears |
| `office.activity.reading: 'web'` | assistant | stays put,  bubble |
| `office.cleared` | assistant | every bubble in the room clears; nothing else moves |
| `library.changed` with `busy > 0` | — | the bookshelf shows *"n"* being filed; **no character** — this is the user dropping files in, not an employee working |
| `knowledge.changed` | — | nothing. There is no knowledge object (§5a) |
| `layout.changed` | — | the cast is re-read; a new employee **fades in** at their spot rather than appearing |
| `office.state: 'stopped'` | everyone | all walking stops mid-floor, all bubbles clear. `/stop` must look like a stop |

⚠ **The animation never gates the state.** A bubble updates the instant its event
arrives, even if that character is still three seconds from the station it is
walking to. The picture may lag; the *text* may not. Reversing this would make the
room show a stale office and quietly turn a display into a source of truth.

---

## 7. Movement

### 7a. The walk

| | |
|---|---|
| speed | **60 world units/s** — unhurried, ~3 s across the room. It is a person crossing an office, not a courier |
| path | a straight line, with furniture treated as one rectangle each and steered around by a single waypoint. **No pathfinding.** The room is deliberately laid out with no concave obstacles, so A* would be a library solving a problem the floor plan already solved |
| turning | `scaleX(±1)` flips with a 120 ms ease. Nobody moon-walks |
| arrival | slot on the ring (§5b), pose `side`, `is-walking` off |

### 7b. A trip is an INTENTION, and intentions expire

This is the user's own rule and it is the sharpest one in the sketch:

> *"if the work with that object is already done, there is no need to go there any
> more — go free to the next object, or be released."*

Formalised:

- each character holds **one** target, never a queue. A new `at` **rewrites the
  target in place**; the character re-aims from wherever it currently stands. It
  never finishes the old trip first, and it never snaps back to re-start
- `task.done` while walking ⇒ **the trip is abandoned** and the hand-off beat runs
  from where the character is (§6d step ②, skipping ①'s walk if it never arrived)
- a queue is forbidden precisely because it would replay a history the office has
  already left behind: a worker walking to the bookshelf for a read that finished
  four seconds ago is the room lying about the present, slowly.

### 7c. `web` and `shell` get NO station — on purpose

Both are real (`WebSearch`/`WebFetch`, `Bash`), and both are the worker reaching
**outside**. Three options were weighed:

| | |
|---|---|
| put them on the arm bench | ⛔ conflates two different things. The bench means *"a connection the user plugged in and can unplug"*; `Bash` and `WebFetch` are tools every employee has by default |
| invent a window/door object | ⛔ the user would learn a symbol that appears nowhere else in the product. Also, `SPEC-offices.md` §6c already flags `WebFetch` as an outgoing data channel — a decorative window would understate it, and a dramatic one would overstate it |
| **stay at their own spot, with a glyph in the bubble** ✅ | honest, costs one glyph, and reads as *"working, from here"* |

⚠ Open, and worth revisiting **only with a real complaint**: `shell` is the one
tool that can touch the user's machine outside the office. If it ever needs to be
visible from across the room, the answer is a marker on the character, not a new
piece of furniture.

### 7d. Standing spots are not a grid

Each worker has an "own spot" on a loose arc mid-floor, derived from
`hash(roleId)` — jittered inside a band, never snapped to a column. Reason, from
the user: a row of evenly-spaced people reads as furniture. The jitter is
**seeded**, not random per render, so a person does not teleport between two
paints.

---

## 8. Bubbles, never a cutscene

The user asked: a `[…]` bubble, or a full-width cut?

**Bubble. And the full-width cut is refused, not deferred.** A cut is a modal
wearing a movie costume:

1. It steals the screen **at the moment the user most wants the Stop button** —
   and *"where do I click to stop"* is a line item in the anti-confusion checklist
   (`SPEC-ui.md` §6) that requires it to be visible at all times.
2. **It does not compose.** Three workers working simultaneously is the *first
   test in the walkthrough*. Three cuts is a slideshow of a thing that is
   happening in parallel — the picture would contradict the plan strip sitting
   right underneath it.
3. It is unskippable time. Everything else in this app answers immediately.

**The bubble:**

| | |
|---|---|
| what it holds | **the same `say` the diagram shows.** One source, one truncation helper (`fitSay`, reused — not a second implementation) |
| shape | SVG `<rect rx>` + `<text>` + a small tail. **Not `<foreignObject>`** — it is a known performance and print-fidelity trap, and it would drag HTML layout into a scene that has none |
| length | one line, ellipsized, full text in a `<title>` (which is also the accessible name) |
| no `say` yet | a `…` with three dots pulsing — the same *"thinking"* shape the chat frame already uses |
| lifetime | mirrors `LiveAgent` exactly: `working` holds, `done` clears after 4.5 s (**the same constant, imported, not re-typed**), `error` **does not auto-clear** |
| stacking | bubbles are drawn in a layer above every character, so a bubble is never behind someone's head |

---

## 9. Idle, and the break area

**Who is in the break area:** an employee that is on the canvas and **not wired** —
`node.connected === false`. Exactly the same source as the word *"resting"* the
diagram already prints, so the two views cannot disagree.

| state | where |
|---|---|
| wired, no task running | its own spot, standing, small idle sway |
| **not wired** | the break area: coffee table, foosball, chess, console+TV. Sitting allowed here and nowhere else |
| archived | **not in the room at all** — archived means gone from the canvas and out of the roster (`SPEC-offices.md` §5.1) |
| gets a task while in the break area | stands up, walks out, joins the floor. That transition is the most legible thing in the whole view: *this person was benched, now they are working* |

**Which game they play is `hash(roleId) % 4`** — stable, so the same person is
always at the chess table, and the room has a memory rather than a shuffle.

**Loitering runs on a timer, not on a simulation.** Every 6–14 s (seeded per
character, so nobody moves in lockstep) an idle character picks a new spot within
the break area and walks there. Between walks, **the rAF loop is not running**
(§12). This is the difference between an office that feels alive and a laptop fan
that never stops.

---

## 10. Read-only for the SHAPE, clickable for the DOORS

The user asked whether the animation is read-only. Split in two, because the
answer differs:

**You cannot edit the company here.** No adding, no deleting, no wiring, no
dragging. The wiring rules are expressed through ports and edges — *"an agent has
no output port"* is the mechanism that makes agent→agent impossible to draw
(`SPEC-canvas.md` §4). There is no honest way to express that in a room full of
people, and a second editing surface for one `layout.json` is the two-write-paths
bug the repo has already paid for twice.

**But everything is clickable, and it must be.** All of it reuses handlers that
already exist:

| click | opens | handler that already exists |
|---|---|---|
| a worker | that employee's Inspector | `actions.select(nodeId)` — identical to selecting the node |
| the assistant | the assistant's Inspector (the tiered prompt) | same |
| the bookshelf | the Document library panel | `onOpenStore('library')` |
| the filing desk | the Results panel | `onOpenStore('artifacts')` |
| the arm bench | the arm's Inspector; with several arms, the nearest one, and a hover label naming each | `actions.select(mcpNodeId)` |
| the break area | nothing | it is a state, not an object |

Drag-and-drop of documents onto the bookshelf works exactly as it does onto the
library node — `actions.dropDocs`, same conveyor (`AppState.pendingDocs`), no
second upload path.

> A room where nothing is clickable teaches the user in about eight seconds that
> this view is a screensaver, and they stop switching to it. Clickability is what
> makes it a **view of the office** rather than a picture of one.

---

## 11. Getting there: the switch, and the sidebar

### 11a. The switch

A two-state segmented control in the **Header**, immediately right of the office
picker:  `⬡ Diagram | ⌂ Office`.

| | |
|---|---|
| persisted | `localStorage['agentco:view']`, per browser |
| **why not on the server** | identical reasoning to `agentco:office` (`store.ts`): two tabs on two views is legal, and putting it on the server makes one tab kick the other |
| what survives the switch | **everything.** Header, sidebar, plan strip, toasts, the Inspector, the selected node. Only the main scene swaps |
| the toolbar | Add employee · Add connection · Rearrange · Fit · Zoom all **hide** in office view. Every one of them edits or navigates the *shape*, which this view does not have (§10) |
| the plan strip | 🔴 **hidden here since 08/09 — this line used to read "stays".** It is `absolute bottom-3`, which on the canvas is empty space and in the room is the **front row**: it covered the people the whole view exists to show. *"Which step am I on"* is still answerable without opening the strip — the chat frame's activity line names who is working and on what, the room itself draws it, and the Plans panel is one click — so this costs a shortcut, not the last copy of a fact (§13). ⚠ The rule it bends (`SPEC-ui.md` §6) is about the **canvas**, where nothing is underneath it |
| first paint | office view is **not** the default. A new user has an empty room and learns nothing from it; they need the diagram to build a company first. Once they have ≥1 employee, a one-line hint offers the room. Their choice then sticks |

### 11b. The sidebar overlays instead of pushing — **in office view only**

The user's instinct is right, and the reason is mechanical:

- in **diagram view**, pushing is correct. The diagram is a workspace you arrange;
  a panel covering the node you are dragging is worse than a narrower canvas.
- in **office view**, the room is a fixed-aspect scene fitted to its frame.
  Narrowing the frame **re-fits the whole room**, so every person and every piece
  of furniture slides and shrinks — motion that means nothing, triggered by opening
  a panel. That is the exact "layout makes the user resize the window" failure
  class recorded in `SPEC-ui.md` §3.1.

So: `position: absolute`, a shadow, **no scrim** (a scrim would say "modal", and
the room must stay watchable while you read the chat). The room keeps its width.

⚠ **The overlay covers the left third, and the bookshelf is there.** Mitigation is
one CSS transform on the scene root: while the sidebar overlays, the scene pans
right by ~40% of the covered width, 200 ms ease. One transform, no re-fit, nothing
re-laid-out. This is also why the **bookshelf** (least dynamic) is on the left and
the assistant/desk (most watched) are centre and right (§5a).

### 11c. Turning the whole feature off — and what "off" has to actually mean

The feature ships **switchable**, because a room full of walking people is a taste
some people will not share, and because a machine that is short of everything
should not pay for scenery.

```yaml
# company.yaml
ui:
  office_view: true      # default; false = the room does not exist
```

**Company level, beside `language` and `allow_core_prompt_edit`** — the same shape
as those two: a company-wide declaration of *whether this door exists at all*.
It is deliberately not per-office (a company does not want the room in one office
and not another) and deliberately not `localStorage` (that answers *"which view am
I in right now"*, a different question, and it stays in `localStorage`).

**Four things "off" must mean, and the third is the one that is easy to fake:**

| | |
|---|---|
| ① | the header switch **is not rendered**. No greyed-out button — a control that exists but never works is worse than no control |
| ② | `web/src/office/` is a **dynamic `import()`**, so the chunk is never fetched. This is what "not installed" means for a local web app: the bytes never reach the browser |
| ③ | **zero runtime cost, provably**: no rAF, no listeners, no DOM. Off must be measurably identical to the build before this feature existed — leg G-10 of test 23 checks exactly that |
| ④ | flipping it back on takes effect **without reinstalling anything** — which is why this is a setting and not an installer checkbox. An install-time choice you cannot reverse is the same decision made worse |

#### The backend fields stay ON even when the room is OFF — and that is deliberate

The instinct is to gate §6c's three fields behind the same switch. **Don't.**

1. **They cost nothing to emit.** All three are classifications the code already
   computed for a different reason (the status sentence, the audit log, the
   status line). Emitting them is attaching a value that already exists to an
   event that is already being sent. There is no token cost, no model call, no
   extra work — the only cost is a few dozen bytes on a local SSE stream.
2. **Gating them means the backend reads a DISPLAY setting.** That is the exact
   shape `docs/CLAUDE.md` spends three sections warning about: a switch that
   answers *"what do I want to see"* reaching into a layer that answers something
   else. `scheduler.ts` should not know that a room exists.
3. **Two code paths drift.** A field emitted only sometimes is a field nobody
   tests in the "sometimes not" direction, and the day someone turns the room on
   after six months it is broken in a way that has never been exercised.

⇒ The fields are **always present, always optional, and ignored by every client
that does not draw a room**. The Telegram bridge, the CLI and the log reader are
unaffected because they already ignore fields they do not read.

#### Access: what the room actually exposes, stated plainly

| worry | answer |
|---|---|
| does the room grant access to anything new? | **No.** Every fact it draws already travels on `/api/events` and is already shown in the log, the plan strip and the activity line. It is a *rendering* of an existing stream, not a new door. §13 states this as a rule: nothing may be visible only here |
| are the new fields more sensitive than what already flows? | **Less.** `task.progress.say` already carries file names and, for `Bash`, the first 60 characters of the actual command. `at: 'library'` and `arm: 'notion'` are strictly coarser than the sentence sitting beside them |
| can another page on the machine read the stream? | Unchanged by this feature. `/api/events` is same-origin and a cross-origin `EventSource` fails without CORS headers; writes stay behind the `Sec-Fetch-Site` / `Origin` / `Host` guards (`SPEC-canvas.md` §7). **This feature adds no endpoint** — it reads the stream that exists and `PUT`s the layout that already existed |
| VPS / `0.0.0.0` mode | unchanged: the daemon already refuses to run without a login token there (`SPEC-ui.md` §5). The room is behind that same token, like every other view |
| the one genuinely new thing | **glanceability.** A room says *"three people are working"* to somebody walking past the desk, where a log said nothing without being read. That is a real property, it is the point of the feature, and the switch above is its off button |

⚠ **Multi-user is still out of scope** (`SPEC-ui.md` §7). When it arrives, the room
needs no rule of its own: whoever may read `/api/events` for an office may see the
room for that office, and whoever may not, may not. If the room ever needs a
permission the log does not need, something has gone wrong in §13 — go fix that
instead of adding a rule here.

---

## 12. Performance budget — numbers, so it can be failed

The quality bar for this feature is the same one already in force: *"dragging a
node stays at 60 fps even while the company is running"*, and *"no LLM turn exists
to power a display"*. This view adds:

| | budget | how it is held |
|---|---|---|
| **idle office** | **0 rAF frames** | the loop is started when something needs to move and **cancelled** when nothing does. An idle office costs the same as a static SVG |
| 3 workers walking | ≤ 4 transform writes per frame, **0 React renders** | positions go into `<g transform>` through refs. Same rule as node dragging |
| limb animation | 0 JS | CSS keyframes, gated by a class |
| DOM size | ≈ 60 static elements + ~14 per character. 8 people ⇒ **~170 nodes** | a 12-node diagram is already ~150 |
| bundle added | **≤ 25 KB gzipped**, 0 new dependencies | scene + character function + loop |
| textures | **none** | this is the whole reason §2 refused pixel art |
| tab hidden | loop stops on `visibilitychange` | a background tab must cost nothing |
| `prefers-reduced-motion` | **no walk cycle at all**: characters cross-fade between stations in 250 ms, no limb animation, no idle loiter | accessibility requirement first, and it doubles as the low-power mode |

⚠ **The loop must be owned by the scene, not by React.** A `useEffect` that
restarts a rAF on every store change is how this becomes the thing that makes the
app stutter while SSE is firing. The scene subscribes once, mutates refs, and
re-renders only when the **cast** changes (someone added, removed, archived,
re-costumed).

---

## 13. Accessibility and language

- The room is **decorative-equivalent**: everything it says is already said in
  text, in the plan strip, the chat frame's activity line, and the log. So the
  `<svg>` carries `role="img"` plus an `aria-label` summarising state (*"3 working,
  2 resting"*), and the per-character detail lives in `<title>`. **Nothing in this
  view may be the only place a fact appears.**
- Focus order: characters and stations are reachable by keyboard, since they are
  buttons that open panels (§10). A station that opens a panel and cannot be
  tabbed to is a door only a mouse can use.
- Every **app-world** string (station tooltips, the switch labels, the aria
  summary) goes through `src/i18n/en.ts` + `vi.ts` like everything else.
- ⚠ Every **product-world** string — every bubble — is `say`, and `say` carries no
  catalogue and names no language. `docs/CLAUDE.md §Language` is the rule; the
  bubble is a pure pass-through and must stay one.

---

## 14. Files, and the order to build them in

### 🔴 FOUR LAYERS, ONE DIRECTION OF TRAVEL

The art was thrown out twice and cost nothing above the renderer line. That is
not luck — it is what the structure is for, and it is worth stating as the shape
rather than as an outcome:

```
  the STORE      says WHAT IS TRUE          SSE, already deterministic
       ↓
  direct()       says WHO SHOULD BE WHERE   PURE · in core/ · TESTED
       ↓
  Stage          moves them there           no DOM, no React, sleeps when idle
       ↓
  a RENDERER     draws it                   ONE adapter, swappable
```

Only the last box knows what a pixel is. Nothing above it changes when the art
does.

```
src/core/
├─ cast.ts             the 10-row table · castOf() · hash32()   PURE, shared via @core
└─ office-floor.ts     the floor plan · ring slots · own spots  PURE, shared via @core
                       └─ direct()  ← THE PLACEMENT RULE, and it is TESTED

web/src/office/
├─ Office.tsx          the ORCHESTRATOR. Draws nothing.
├─ scene.ts            THE PORT — SceneProps (rare) + SceneHandle (per frame)
├─ motion.ts           the loop: targets, arrival, the idle timer. DOM-free.
├─ art/manifest.ts     the ART SOCKET (§2c). `null` ⇒ built-in drawing
├─ CharacterPicker.tsx · ContactSheet.tsx   (dev/inspector surfaces)
└─ renderers/
   └─ dom/             ONE ADAPTER — the only place that knows about HTML/SVG
      ├─ DomScene.tsx  implements the port: <svg> room + HTML people layer
      ├─ Room.tsx      the furniture
      ├─ Character.tsx the built-in drawing (§2a · §2b)
      ├─ LottieArt.tsx the Lottie player, used when the socket is filled
      └─ office.css
```

**Two debts this closed, both of which had already bitten:**

| | |
|---|---|
| `direct()` lived **inside a `useEffect`** | the rule that decides *"this worker walks to the bookshelf"* — the one that can state something that never happened — sat where `node --test` cannot reach. The repository had already written this lesson down for `buildPlan`: *"when an important rule lives in a function no test can touch, the real debt is the SHAPE OF THE CODE, not the missing test."* Now pure, in `core/`, **14 tests** |
| the loop **held DOM elements** | it wrote `transform` onto an `SVGGElement` per actor. That worked for two adapters and would have broken the third — a 3D scene has no element per person. The loop now owns POSITIONS and hands them to a `SceneHandle` |

**The port has two channels, and the split IS the performance rule:**

| | what goes through it | cost |
|---|---|---|
| `SceneProps` | who exists, their name, their bubble — changes on an SSE event | one React render |
| `SceneHandle` | position, facing, walking — changes every frame | **never touches React** |

Collapsing them is how a diagram that held 60fps under load becomes a room that
re-renders the tree sixty times a second while SSE is still delivering into it.

The whole `office/` directory is reached through **one dynamic `import()`** from
`App.tsx`, so `ui.office_view: false` never fetches it (§11c②).

**Adding a renderer** (three.js + glTF, say) is: one file implementing
`SceneComponent`, one line in `Office.tsx`, and `NEEDS_WALK_STATE` if it has to
be told which clip to play. Nothing else moves.

Backend, all three additive (§6c): `core/worker.ts` (`describeCall` → `{say, at,
arm}`), `core/scheduler.ts` (put the fields on the event), `core/office.ts`
(`reading` on `office.activity`), `core/layout.ts` (`cast` through
`readRaw`/`writeRaw`/`save`/`dropAgent`), `core/types.ts` + `web/src/lib/types.ts`
(the field declarations, in **both** copies — that duplication is deliberate and
`tsc` will not catch a mismatch).

**Build order — each step is visible on its own:**

1. **The room with nobody hired yet.** Floor plan, all five stations, **the
   assistant standing at centre-front** (§5a′). Header switch, `ui.office_view`,
   the dynamic import, sidebar overlay. Proves the scene, the fit, the switch and
   the off-path — before a single walk cycle exists.
2. **The cast, standing still.** `Character` + `castOf` + **the contact sheet
   first**, so the proportions are settled before ten variations exist. Everyone
   at their own spot or in the break area. Still zero animation.
3. **Bubbles + the assistant.** Wire `office.activity`, `master.message`,
   `task.*` bubble text. **No walking yet** — the room is already more useful than
   the diagram at this point, and it is honest with zero backend changes.
4. **Motion.** The rAF loop, walking, the hand-off beat, idle loiter.
5. **Backend field ①**, then stations light up for real.
6. **Backend fields ② and ③** — the assistant's bookshelf trip, and the costume
   override in the Inspector.

Steps 1–4 need **no backend change at all**. If the three fields are ever refused,
the feature still ships — it just has furniture nobody visits, and §6a says
plainly why.

---

## 15. Out of scope

- **Multiple rooms / walking between offices.** One office, one room. Cross-office
  is still M3+ (`SPEC-canvas.md` §8) and nothing here changes that.
- **Editing anything from the room.** §10.
- **Sound.** Ever, without being asked.
- ~~**A camera.** No pan, no zoom, no follow.~~ ⚠ **REVERSED, 07/09 → §17h.** Zoom
  and drag-to-pan are in. What survives of this line is the half that was doing
  the work: **fit-to-window is the floor**, so the room still fills the frame and
  no camera state can ever put a white margin back around it. Follow is still out.
- **Pathfinding, physics, collision between characters.** People may pass through
  each other. Nobody has ever complained about that in a diagram, and solving it
  costs a loop that never sleeps.
- **A worker→worker interaction of any kind.** It does not exist in the
  architecture, so it must not exist in the picture — this view's single largest
  risk is teaching a mental model the product does not implement.
- **A day/night cycle, seasons, decorations.** Amusing, permanent, and a
  never-ending source of "why is my office dark".

---

## 16. Open — needs a decision before build

1. **The three backend fields (§6c).** Additive, tiny, zero-token — but they are
   backend, and the brief said to report any. Without ① the bookshelf and the arm
   bench are never visited; without ② the assistant never reads; without ③ a
   costume change cannot be saved per office.
2. **`web` / `shell` (§7c).** Settled here as *"stay put, glyph in the bubble"*.
   The alternative — a window object — is one drawing away if it turns out people
   look for it.
3. **The default view for an office that already has employees.** Settled here as
   *"diagram, until they switch"*. The opposite (room by default once staffed) is
   defensible and would be a one-line change.
4. **`ui.office_view` default.** Settled here as **`true`** — a feature that ships
   off is a feature nobody discovers, and §11c makes off genuinely free. The
   opposite (`false`, opt in from Settings) is the conservative reading and is
   also one line.

---

## 17. Round 3 (07/09) — eleven changes, and the two that reverse this file

> ⚠ **§17j′ · §17k′ · §17l · §17m are ROUND 4**, later the same day: five things
> the user found by using the room the round before had just shipped. Two of them
> are halves of round 3 that never landed (§17j′), one is a rule stated for one
> field and not for the field beside it (§17k′).

Everything below is a decision already taken. It is written here rather than in a
commit message because four of the items **contradict a sentence this document
already carries**, and a reader who finds only the new code would fix it back.

### 17a. The order of work, and what it is ordered BY

Not by how much anybody wants each one. By **what each one has to know first**:

| | | depends on |
|---|---|---|
| **A** | six small doors: two dead paragraphs, one dead click target, one control shown in the wrong view, the wire's delete button, the stuck tooltip | nothing |
| **B** | resting people are **dealt once per toggle**, and the assistant's two rules | nothing |
| **C** | **depth by `y`**, replacing the `front` flag | nothing — but A/B read easier after it |
| **D** | zoom + pan | C (both write to the same stage) |
| **E** | the **location map** and the idle rhythm | C (the desk rule IS the depth rule) |
| **F** | the garment tint (§SPEC-office-art §11) | new mask strips per sheet — **art work, not code** |

⚠ **F is last and it is not laziness.** The masks in the repository's history were
derived from the **v3** sheets, and four of the five sheets were replaced with v4
art on 06/09. A mask is a per-pixel statement about one drawing; pointing an old
one at a new drawing is the failure class §11 already names — *"check which file
the app actually loads before debugging what it does with it"*.

### 17a′. All six shipped on 07/09

`npm test` **1036 pass · 0 fail**, `tsc` clean on both projects, `check-language`
clean, `vite build` clean.

⚠ **F nearly stopped at "c1 cannot be tinted", and that was a wrong conclusion
from a correct measurement.** Only the LIGHTNESS family had been tried; the jacket
and the trousers are 16 points apart in `B − R`. The full account is in
`SPEC-office-art.md §11a`, and it is the more useful half of this section.

### 17k. The garment tint — who gets one, and who decides

**Nobody is tinted until two people share a face.** The colour exists to separate
employees who look alike; the first holder of a face wears the colour the sheet was
drawn in, and **gets no layer at all**. That last clause is a performance rule, not
a phrasing: a `mix-blend-mode` element forces a compositing pass for that actor on
every frame it moves, whether or not it changes a pixel. *Absent* and *transparent*
are the same picture and two very different machines.

| | |
|---|---|
| **who** | every holder of a face except the first, in sorted order |
| **which colour** | dealt from a **per-face basket** — the person's hash is their preference, a clash probes to the next free colour |
| **stored?** | ⛔ **no.** Computed on every read, exactly like `assignCast`, and for the recorded reason: the only place that knows the whole roster is `canvas()`, and `canvas()` is a READ. A read that writes `layout.json` and emits `layout.changed` is a feedback loop this repository has already paid for once |
| **a hand-picked colour** | **is** stored (`layout.json → tint`), wins outright, and takes its seat in the basket *before* any dealing — the same rule a hand-picked face already has |
| **the cost, stated** | firing somebody can change the colour of whoever their face-clash had displaced. One mechanism, one cost, already accepted for the face |

> 🔴 **A plain `hash % 10` was written first and it collided in the live room** —
> two of seven tinted people came out `#5c6b3f`. That is the twins bug one layer
> down, at exactly the rate the birthday problem predicts, and a collision here is
> two employees who look alike **and** wear the same colour: the precise state the
> colour exists to prevent. Deal from a basket; never trust a hash to be distinct.
>
> ⚠ **Two people on DIFFERENT faces may share a colour, and that is not a clash.**
> The basket is per face on purpose. Making colours globally unique would run the
> palette out at eleven employees to fix something nobody can see.

**The picker** is a row of the ten palette swatches plus a native
`<input type="color">` for anything else — that control opens the OS's own
continuous picker, is the one the user already knows, and costs zero bundle bytes.
It writes on `input`, not `change`, so the room follows the pointer while the
dialog is open; **the save is debounced 350 ms**, or one drag across the spectrum
is two hundred writes of `layout.json` and two hundred `layout.changed` broadcasts.

⚠ **The ten palette colours are all mid-lightness, and there is a test for it.**
`mix-blend-mode: color` keeps the artwork's luminance, so a near-black or
near-white entry would be a swatch that visibly does nothing.

⚠ **The tint layer runs the walk animation on `mask-position` as well**, from the
same numbers as `background-position`. Measured in the browser across all four
cells: identical to three decimal places. This is the one defect that is invisible
until somebody walks.

### 17b. 🔴 THE `front` FLAG IS GONE. DEPTH IS `y`, IN ONE STACKING CONTEXT.

This **reverses** `core/office-floor.ts §BreakPiece.front`, which reads:

> *"IT IS NOT A GENERAL DEPTH SYSTEM AND MUST NOT BECOME ONE. … Real depth needs
> a per-frame sort of two layers that do not share a coordinate system, and
> nothing here is worth that."*

That paragraph was right about the **cost** and wrong about the **price** — three
of this round's requests are each, separately, a request for real depth:

| the request | what it needs |
|---|---|
| *"a character standing behind the filing desk is covered by it; in front of it, covers it"* | sort desk against person by `y` |
| *"if two people overlap, the lower `y` wins"* | sort person against person by `y` |
| *"the assistant always covers every worker"* | one person outranks the sort |

Three separate front-layer flags would be three mechanisms answering one question,
and they would disagree the first time somebody walked between two of them.

**And the two layers now DO share a coordinate system.** The quoted sentence
assumed they could not — the furniture is `<svg>` and the people are HTML. The fix
is to move the *few pieces that need sorting* into the HTML stage as absolutely
positioned images placed by the same `(x, baseY)` convention. One stacking
context, one integer:

```
z-index = round(baseY)          furniture and people alike
z-index = ASSISTANT_Z           the assistant only  → §17d
```

Written in `apply()` beside the transform it already writes, so it costs one more
style property on a node that was being touched anyway, and **zero** on a frame
where nobody moves.

Three things this must not become:

- ⚠ **Not every piece.** The plant, the cooler and the bookshelf are objects
  §17f forbids standing behind, so sorting them buys nothing and costs a DOM node
  each. Only the two desks and the chess set move up.
- ⚠ **The SHADOW stays in the `<svg>` room.** A shadow is on the floor and
  belongs under everybody's shoes. This is the split `Furn(only=…)` already makes,
  and it survives unchanged.
- ⚠ **`pointer-events: none` on every promoted piece.** They sit over the stations'
  hit rectangles, and a desk that swallows the click that opens Results is the
  `.office-front` trap that was already paid for once.

### 17c. Resting people are DEALT ONCE, and the deal is not walked into

`direct()` today seats the resting in `agents` order, so the room re-seats
everybody when one person stops resting, and somebody switching to this view
watches six people slide into a corner.

| | |
|---|---|
| **who** | up to `BREAK_CAPACITY` of the resting people, chosen at **random** |
| **when** | once per **mount** of the office view — a toggle or an `F5`, nothing else |
| **stability** | fixed until the next mount. A person who starts working leaves their seat and **does not give it away**; the seat stays empty and theirs |
| **how they arrive** | ⚠ **already there.** `Stage.sync` places somebody at their home the first time it sees them, precisely so nobody animates an arrival that never happened. A resting person's home IS their seat |

⚠ **The seed is per-mount, and it must be a real random, not a hash of the
roster.** A hash would give the same six people every reload forever, which is the
thing this replaces wearing a different coat.

### 17c′. 🔴 …and the SECOND question was never actually asked

> *"I am still not happy with the randomisation. First pick at most six of the
> resting people at random out of the pool; then randomise each one's position,
> depending on nothing. Toggle or F5 re-rolls those positions."*

Two questions, and §17c above only ever answered one:

| | |
|---|---|
| **WHO** gets a seat when more than six are resting | shuffled — correct since 06/09 |
| **WHERE** each of them sits | ⛔ **not shuffled.** The free seats were handed out in ascending index order |

So four resting people came out on seats 0, 1, 2, 3 — both sofa cushions, the
chess stool, the counter — **every deal, every reload**, and the foosball table
only ever had anybody at it at exactly six. The line-up was random and the layout
was a constant.

⚠ **The old comment argued against the fix, and it was not wrong — it was
answering the wrong question.** It read: *"shuffling `free` instead would only
randomise which cushion each of the same six got."* True. *Which cushion* is
precisely the half the user can see.

⚠ **Only the FREE seats are shuffled.** Anything already dealt keeps its cushion —
a seat is that person's for the life of the mount, even while they are away
working (§17c). Re-dealing those is the every-event reshuffle this function exists
to prevent.

🔴 **This RETIRES a rule from §17c, and the rule is deleted rather than softened.**
It said: *"ORDER IS FILL ORDER — sofa first because one person resting should look
like resting; foosball LAST because a single figure at a foosball table is a person
with no opponent."* Independent placement gives that up: **one resting employee can
now turn up alone at an end of the foosball table.** Accepted knowingly — the ask
was *"depending on nothing"* with the old rule in view — and reversible with one
weighted pick if the lone player ever reads badly.

⚠ **A test at full capacity cannot see this defect.** Six people into six seats is
a permutation whether or not the seats are shuffled, so the gate has to be the case
with **fewer people than seats**: over many deals, every seat index must be
reached. Verified by deleting the shuffle — the capacity test stayed green and the
under-capacity one went red with *"1 resting reached only seats 0"*.

### 17d. The assistant — §6d was half right, and this is the other half

`§6d` says *"the assistant never leaves centre-front"*. The user's rule is finer,
and it distinguishes two things this document had merged:

| when | where |
|---|---|
| the view mounts (toggle / `F5`) **and no task is running** | `ASSISTANT_SPOT`, the default |
| it has handed work out and is **waiting for a receipt** | the **waiting spot** beside the filing desk, and it stays there |
| the wait ends | ⚠ **it does not walk home.** Going back would be a trip that reports nothing; home is where the *next mount* puts it |
| its hidden worker is reading documents | **still walks to the bookshelf** — §6e keeps this, because it is the one trip that draws an observed fact |

⚠ **Always on top.** The assistant is the one figure the user must never have to
hunt for, so it takes a `z-index` above every worker and every promoted piece of
furniture. That is a stated exception to §17b's rule, not a hole in it.

⚠ **Nobody walks to the assistant, ever.** The workers' location map (§17f) does
not contain its two spots, and a worker may not choose one as a target.

### 17e. A worker being GIVEN work stops where it stands

Not "finishes the trip first, then waits". `task.started` for that role freezes
them at their current position — which is `Stage.setTarget(id, positionOf(id))`,
i.e. exactly the §7b rule *"a trip is an intention, and intentions expire"*
applied to a beat that had never used it.

### 17f. 🔴 THE LOCATION MAP — and the SAFE AREA that governs all of it

This replaces *"§7d standing spots are not a grid"* as the only answer to *where
can somebody stand*. `ownSpot()` survives as **one entry in the map**, not as the
map.

**① The safe area is a law about BOUNDING BOXES, not about feet.**

A person is placed by their feet, and every rule anybody writes by hand is written
about feet — which is how a figure ends up half inside the wall while its
coordinate is legal. So the safe area is stated once, in body units, and checked
against the box:

```
HALF_W   62      half the widest figure at the largest per-sheet scale
BODY_H'  196     feet to the top of the tallest hair, same scale
```

| edge | value | why THAT edge |
|---|---|---|
| top | `HORIZON + 24` | feet above the wall/floor junction is a person climbing the wall |
| bottom | `WORLD.h − 22 − NAME_DROP` | the front row must not be cut by the frame — **name included** |
| left | plant's right edge `+ HALF_W` | *"never to the left of the plant"* |
| right | `BREAK_AREA.x − HALF_W` | *"never in the break area, and never right of it"* |

🔴 **`NAME_DROP` (24) is the third body number, and the bottom edge was written
without it.** A person is not only a drawing: `.actor-name` hangs below the anchor
(`top: 6px`, a ~17-unit line box), so the front row's labels ran off the floor
while every measurement said the room was legal. Exactly the failure ① is about,
one layer out — the rule was written about the part of the figure the author had
in mind rather than about the whole of it.

**② Objects nobody may stand behind.** The plant, the bookshelf + cabinet, the
cooler, and the wall itself. For these the rule is one-directional and absolute:
where the horizontal spans overlap, **the person's feet are below the object's
base, by at least one gap**. There is no depth question to answer because there is
no legal way to be behind them.

**③ Objects people MAY stand behind — the two desks.** The filing desk and the arm
bench. Behind means the desk covers the person; in front means the person covers
the desk; and *"behind"* is decided by nothing but `baseY`, i.e. §17b. This is why
E depends on C.

**④ The map.** Every entry is a fixed point in world coordinates, derived from the
piece it belongs to — never a literal, for the reason `BREAK_PIECES` was created:
two copies of one layout drift, silently, within one change.

| where | slots | |
|---|---:|---|
| the plant | 2 | **off to its right**, and further right again — never dead-centre (see below) |
| the bookshelf + cabinet | 3 | in front |
| the picture | 1 | in front |
| the window | 2 | in front |
| the planning board | 1 | in front |
| the cooler | 1 | **off to its left**, for the same reason |
| **the filing desk** | **8** | 3 in front, 3 behind, 1 at each end |
| own spots | **10** | `ownSpot(0…9)`. ⚠ the eleventh is dropped — at `PER_ROW = 5` it lands at `y = 950` in a 900-unit world, i.e. off the floor |
| beside a **standing** worker | 1 per such worker | ⚠ **pairs only, never a group of three.** A spot beside somebody who is already half of a pair is not offered |
| fallback | 1 | a random point in the safe area, retried a few times against everybody's box |

⚠ **The assistant's two spots are not in this table.** → §17d.

🔴 **A narrow object standing behind a person is an object nobody can see, and
the rule is stated as the SLIVER, not as the offset.** A body is 124 units wide;
the plant is 74 and the cooler 39, so dead-centre erases both. The break area
already knew this (*"a person is wider than half the counter, so dead-centre
erases the whole object"*) and the working floor had never been told.

⚠ **`offset = HALF_W + VISIBLE − halfW`, and the first cut got the direction
backwards.** *"Stand 24 units past the object's edge"* sounds object-relative and
is not: it leaves `2 × halfW + 24 − HALF_W` showing, which is **36 units of the
plant and 2 units of the cooler**. The narrower the piece, the less the rule gave
it. State the outcome — 22 units of the object still visible past the body — and
solve for the offset; the numbers then follow the artwork rather than the other
way round, and `test/office-view.test.ts` holds `halfW` against the PNG's own
`h × ar`.

**⑤ Choosing a target.** Uniformly at random among the map's entries, **skipping
any that somebody is standing on or already walking to**. Not nearest, not
weighted: nearest turns the map into a rut, and a weighting is a preference nobody
asked for.

### 17f′. 🔴 A station has a place it is USED from — the ring is overflow (08/09)

> *"The positions for a worker using the arm, and the document cabinet, could be
> a bit closer — right now they are a little far, or a little off to one side."*
> · *"Not moving the furniture, only the worker's target position?"* — **correct,
> and nothing in the room moved by one unit.**

**The picture was backwards, and the measurement says it in one line.** §5b picks
the ring slot **nearest the walker**, and workers arrive from the floor — from the
right and below. So:

| | where they were sent | the object, as drawn |
|---|---|---|
| reading documents | **(449, 483)** — 88 units past the cabinet's right edge | bookcase + cabinet span x 194…362 |
| using the arm | **(398, 770)** — 41 units past the desk's right edge, in front of it | `desk-laptop` spans x 195…357 |
| *an idle colleague* | **(292, 462)** — right in front of the cabinet | — |

The person **using** the object stood further from it than the person doing
nothing. Nearest-free was never wrong about *which* station; it was wrong as the
answer for the **first** person to arrive.

**`Station.use`** — `front` · `behind` · absent:

| | |
|---|---|
| `front` | dead centre in front, and it **adds no coordinate**: it is the ring's own first slot, asked for instead of being one of six candidates a distance test almost never picked. Library ⇒ **(283, 451)**, whose centre falls in the 16-unit gap between the bookcase and the cabinet |
| `behind` | the far side of a desk, `BEHIND_DESK = 48` above its base — **one constant, two desks**: the three idle places behind the filing desk were a literal `- 48` and now read the same name, held by a test that compares the two gaps. Arm ⇒ **(276, 688)** |
| absent | the filing desk keeps nearest-free. It is the one station with a crowd — every finished task with files walks there (§6d) — and nobody reported it. Completing the set is a change nobody asked for on the busiest object |

⚠ **The depth sort is what makes `behind` legible, and it is NOT what puts anybody
there.** `z-index = round(baseY)` for furniture and `round(y)` for people already
existed (§17b) — it answers *"standing here, who covers whom"*. It does not answer
*"where does the worker walk"*, which is `nearestFreeSlot`. Drop `use` and the
worker is still sent in front of the bench, and the sort correctly draws them over
the desk, because that is where they are standing.

⚠ **Centred on the DESK, not on the laptop drawn on it.** Measured in
`desk-laptop.png`: the laptop centres at **0.4878** of the image width, i.e. **2
world units** left of the desk's centre, against a 124-wide body. A
`laptopOffset` would be a measurement of an image somebody has to keep in step
with the art, bought for two units nobody can see.

⚠ **The occlusion is a two-file constraint, so the gate sits where both halves are
visible.** `core` picks the point from a 312-wide rectangle; the desk that must
cover the legs is a 161-wide PNG whose size lives in `art/furniture.ts`.
`test/office-view.test.ts` holds them together — the failure it prevents is silent
(a person standing in a strip of floor behind a desk that no longer reaches them,
which reads as a rendering bug and gets looked for in the image file).

**What did NOT change:** every station rectangle, every piece of furniture, the
ring itself, and nearest-free for the second arrival onward — including at the two
stations that gained a primary place.

### 17d′. 🔴 The assistant is no longer drawn on top — and that was only HALF the report (08/09)

> *"Why is the assistant shielded from being overlaid by a worker? Revert it."*
> · *"The case I saw is a near 1-to-1 overlap, not a partial one. Am I seeing
> things?"* — **No. Measured, in the user's own offices:**

| office | employees | nearest standing spot to `ASSISTANT_WAIT` |
|---|---|---|
| **so-sach** | 2 | **39 units** |
| **inventory** | 2 | **45 units** |
| ra-hop-dong · test | 3 · 5 | 83 · 86 |
| noi-dung | 3 | 97 |

A body is 124 wide, so 39 units is two figures sharing one silhouette. And it is
**deterministic, not luck**: with two employees `ownSpot(1, 2, …)` lands at
x ≈ 638 ± 20, y ≈ 546 ± 12, while `ASSISTANT_WAIT` is (664, 566) — the assistant
waits *in the middle of the workers' own row*.

⚠ **The comment beside `ASSISTANT_WAIT` said this was checked.** It was — against
`HOME_SPOTS`, the map pinned at `total = 10`. The spots people actually stand on
come from `ownSpot(i, headcount, id)`, and at `headcount = 2` they are somewhere
else entirely. **The same "the gate watches the copy" lesson as §17f①**, one
layer out.

**What shipped: `onTop` is deleted** — the flag, its `z-index` override, the
renderer's per-actor exception, all of it. `z = round(y)` now governs every body
with no exception to keep in step. The reason it was there (*"the one figure you
must never have to hunt for"*) does not survive the measurement: no stacking
order rescues two people standing 39 units apart.

⚠ **This does NOT close the overlap**, and it is stated so nobody reads a green
test as a fixed room: the two figures still stand 39 units apart, they are now
merely layered correctly. Closing it means moving the assistant's waiting spot
out of the arc band — the rows sit at y = 546 and y = 748, and every x is
reachable by some headcount — or dropping `ASSISTANT_WAIT` and returning to §6d's
*"the assistant never leaves centre-front"*, which is the only spot the arc
provably never reaches. **Still open.**

### 17f″. 🔴 The seventh person at one station used to stand INSIDE the sixth (08/09)

`nearestFreeSlot`'s own comment read *"every slot taken ⇒ stop at the ring's
**edge** rather than stack two people on one spot"* — and returned **one point**
to everybody who asked. Measured with nine workers all reading documents: six
took the ring, and the last three all stood on **(283, 500)**.

The fix is an **edge row**, spaced by `BODY_HALF_W × 2 + 6` and grown outwards
from the centre, with points outside the safe area **dropped rather than clamped**
(clamping two of them lands both on the same edge x — the same stacking, wearing a
different coordinate). It lives in `nearestFreeSlot`, so all three stations get it
from one change. Measured after: nine distinct places.

⚠ Past the ring plus the edge row the room has genuinely run out of floor at one
object, and the last resort still stacks. That is **stated in the code** rather
than hidden behind another promise — it needs ~12 workers at one station in one
office, which the scheduler does not produce.

### 17g. The idle rhythm — 45 s, and the trip is NOT a duration

> *"Standing 45 s. The trip cannot be a decided number — it depends on the
> distance from source to destination."*

Which is the rule §2b already carries for the walk (*"distance ÷ 60 u/s — a
duration is never hard-coded, or a short trip looks like a lunge"*), now applied
to the thing that schedules the walk. So:

- an idle worker holds for **45 s**, then picks a target and walks it
- ⚠ **seeded per person, spread across the window**, or eight people who arrived
  in the same paint all move at the same instant, forever
- ⚠ the timer exists **only while somebody is idle and the tab is visible**. This
  is the `setTimeout` chain that was deleted with `breakSpot()` (see the note at
  the foot of `office-floor.ts`) coming back — and it comes back with the reason
  it was deleted written next to it: *the wandering it powered spent the room's
  only signal for work on nothing*. What makes it survivable this time is that
  the break area is still **completely still** — §17c seats people and they stay
  seated. Only the working floor breathes.
- ⚠ **resting people never get a timer.** Movement is this room's vocabulary for
  work, and a resting person moving is the room lying, slowly.

### 17g′. 🔴 Being wired SPENDS the hold instead of waiting it out (08/09)

> *"Reconnecting somebody who was resting does stand them up — but it stands them
> up in the break area."*

Reported after using it, and the cause is not a slip; it is two correct rules
meeting. `direct()` returns `{ target: home, roam: true }` for somebody wired and
idle, and `Office.tsx` deliberately never `setTarget`s anybody roaming (**two
owners of one destination, and the timer wins a second later** — §17f). So the
only thing that could move them was the idle timer, whose **first** delay is
seeded: `hash32('idle:' + id) % 45 s`. **Measured: 0–45 seconds standing on the
rug**, which reads as *still resting*.

| | |
|---|---|
| the fix | `releasedFromRest(prev, placements)` in `core/` names **who** was `rest` last pass and is `roam` this pass; the view hands each of them to `Stage.nudge` — the same *"go now instead of waiting out the hold"* the opening walk (§17l) already uses |
| ⚠ what it is NOT | a second kind of walk. `pickIdleSpot` still chooses **where**, the ordinary 45 s cadence re-arms behind it, and there is one code path for *an idle worker walks somewhere* |
| ⚠ a TRANSITION, never a position test | *"anybody roaming who is standing on the rug"* would re-fire on every SSE event while they were stuck there, and **each firing re-arms the hold** — so a crowded floor (`pickIdleSpot` → `null`) would keep resetting the very timer that is their way out |
| reduced motion | silent through the existing gate, not a second check: `setRoam` refuses to set `roam`, and `nudge` refuses anybody not roaming |
| released straight into a TASK | not nudged — that person is not roaming, and their placement already owns the trip (§17e) |
| the seats | untouched. A seat is that person's for the life of the mount (§17c), so leaving early moves nobody else |

### 17h. Zoom — and this reverses §15

`§15` lists *"A camera. No pan, no zoom, no follow"* as out of scope. It is now in
scope, with the bound the user set and the reason it is that bound:

| | |
|---|---|
| **fit-to-window is the MINIMUM** | `1.0`. It is never possible to zoom out past it, so the letterbox that §4 of the art spec just spent a round removing cannot come back through a new door |
| maximum | `3.0` |
| wheel + two buttons | the buttons faint and translucent, bottom-right |
| drag to pan | clamped so the visible rectangle stays inside the painted room |
| persisted | `localStorage`, per browser, beside `agentco:view` — same reasoning: two tabs at two zooms is legal |

⚠ **Applied inside `fit()` and nowhere else.** It is a multiplier on the single `k`
that keeps the SVG room and the HTML people in register; applied to one layer, the
two drift apart by exactly that much. → `SPEC-office-art.md §10`.

### 17i. Four doors that were open and should not have been

| | |
|---|---|
| the employee-delete modal named `roles/<id>.yaml` | the file path is our filing detail, not the user's decision. What they are deciding is *delete this person* |
| the character picker explained itself in two sentences | *"costs nothing and changes nothing about the work"* is reassurance about a worry nobody has when the control is a row of five faces |
| the character picker was offered in **diagram** view | it is a costume for a room the user is not looking at. Gated on `officeView` already (§11c②); now also on the view actually being open |
| clicking the arm bench opened one arm's Inspector | there is **one bench and N connections**, so *"the nearest one"* was a coin toss wearing a rule. The bench keeps its label and stops being a door — §10's table loses that row |

### 17j. The wire's delete button, and the tooltip that would not go away

**The wire.** A hovered edge now lifts above every other edge and every node, so
its delete button is reachable without dragging the diagram to make room. The
button becomes the **trash icon already in the bundle**, on both edge kinds.
⚠ Lifting is a **paint-order** change on hover, not a `z-index` on an SVG group
that has none — SVG sorts by document order and nothing else.

**The tooltip.** Not "stuck": Radix opens a tooltip on **focus**, and returning to
the browser window re-focuses whatever was focused when it left. A button clicked
with a mouse therefore grows a tooltip that nothing dismisses, because the pointer
never entered it. The fix is to open on focus only when the focus is **keyboard**
focus (`:focus-visible`) — which is also the only case a tooltip on focus was ever
for.

### 17j′. …and only HALF of §17j shipped. Round 4 (07/09)

§17j promised *"a hovered edge lifts above every other edge and every node"*. Only
the **button** was lifted. The user read the difference straight off the screen and
asked whether it was intended:

> *"When I select a connection it only lights up the bin, not the whole wire — is
> that right? Because if I go for the delete button and meet another node on the
> way, the wire is lost and I cannot delete it."*

Both halves of that are the same missing lift, and both are now closed:

| | |
|---|---|
| **the whole wire lights up** | a SECOND drawing of the same curve, in `.edge-tools` (above the nodes), shown only while the edge is hot. The wire in its ordinary state stays under the nodes — that is the diagram's whole depth story — so the highlight is a copy, never a move. `pointer-events: none`: it crosses every node its wire crosses, and taking hits up there would swallow the clicks that open them |
| **a click LATCHES the edge** | hover still previews and the preview still expires after 90 ms; a latched wire stays lit until the user clicks elsewhere or presses Escape, so the trip to the button has **no time limit at all** |

⚠ **A longer grace period is the same bug with a wider window.** The button sits at
the wire's midpoint, which on a real diagram is routinely on top of a third node,
and the pointer can dwell over that node for as long as it likes. Only a state that
outlives the pointer answers it.

⚠ **The two elements that must not clear the latch — the wire's hit path and its
own button — both `stopPropagation`,** so the canvas's `onPointerDown` never sees
them and can clear it unconditionally. One rule expressed by *which events arrive*,
rather than a list of exceptions a new element can fall off the end of.

### 17k′. 🔴 The costume change that disconnected the whole office

> *"I change somebody's character or shirt colour in the office and EVERY
> connection on the canvas is cut, the mcp ones included."*

Exactly that, and the cause is one line. `setCharacter` PUTs `{cast}` and `setTint`
PUTs `{tint}` — deliberately, so a colour change does not have to send the diagram
— and `LayoutStore.save` read the missing `edges` as *"cut them all"*:
`sanitizeEdges(undefined, …)` returns `[]`. The empty list was then written to
`layout.json` **and** run through the mcp split, which found no servers and emptied
`mcp:` out of every `roles/*.yaml` and out of `office.yaml`.

🔴 **The rule was already written down, one line below, for the OTHER field.**
`save()` carries a box saying *"ABSENT ≠ EMPTY: the canvas PUTs `{nodes, edges}` on
every drag and says nothing about the cast; reading that silence as 'clear it'
would undress the whole office"*, and `api.ts` promised the same thing in the
reverse direction. Two comments, both correct, and **no mechanism between them** —
the failure class this project has paid for more than any other.

⚠ `current.edges` **round-trips exactly**, which is what makes falling back to it
safe rather than merely quiet: `read()` rebuilds the mcp edges from the yaml, so
the split re-derives the same lists and nothing is written; and `writeRaw` filters
mcp edges back out, so `layout.json` is written with what it already held.
`test/layout-save.test.ts` is the gate, and it asserts all three places a wire
lives — a test that checked only `layout.json` would have gone green while the arms
still vanished.

### 17l. Opening the room — the line-up, and the office that looks asleep

> *"I do not want every toggle to go back to the default line-up … or, simpler,
> just randomise from the location list on each toggle. But there is another
> problem: everybody standing still at that moment is a bit stiff. Could a few
> characters already be moving? About one in five, minimum one (⇒ ceil), to show
> the office is always working. F5 is default — but still with the one-in-five."*

Three rules, and the third is what lets the first two differ:

| | |
|---|---|
| **a reload** | everybody starts at their own spot — `ownSpot`, the five-wide arc. The default the user asked to keep |
| **a toggle** | idle workers are **re-dealt** across the location map, one at a time, each pick made in a world that already holds everybody dealt before it |
| **both** | `ceil(idle / 5)` idle workers set off on an ordinary idle trip **immediately**, instead of waiting out the 45 s hold |

⚠ **The only difference between a reload and a toggle is that a reload throws the
MODULE away.** So the mechanism is one module-level boolean in `Office.tsx` — false
exactly once per page load. Nothing stored, nothing to expire; anything durable
(`sessionStorage`, the server) would survive F5 and answer the wrong question.
In dev, StrictMode's double-mount spends the first open, so a `dev:web` reload
takes the toggle branch. Stated rather than worked around.

⚠ **Re-dealing was chosen over carrying live positions across the toggle, and it is
the answer to BOTH halves of the message.** Continuity nobody can see is not worth
buying — the room was not on screen — and preserved positions would freeze the same
people in the same places for the life of the tab, which is the *"avoid sitting and
standing put"* the same message asks against.

⚠ **A miss is an absent entry, never a guessed point.** `pickIdleSpot` answers
`null` when everywhere is taken, and the caller falls back to the person's own
spot. A crowded office degrades to the old picture rather than to bodies inside
each other.

⚠ **`walkersAtOpen` is a COUNT, not a probability.** A one-in-five die rolled per
person gives an office that is occasionally completely still, which is the one
outcome this exists to prevent. And it refuses anybody not roaming: a worker with a
task, and every resting person, are unreachable from it — the room may look busier
when it opens, it may not **claim** anything that is not happening (§17g).

### 17m. Dragging the room was selecting every name in it

> *"While dragging, could the cursor be a grab hand? Right now it highlights all
> the text, like a stuck double-click."*

Not a bug in the drag code: panning is a pointer-down and a move, which is
byte-for-byte the gesture that selects text, and nothing had ever told this surface
it is a picture rather than a document. `user-select: none` on `.office-root` — on
the root, not on `.actor-name`, because the bubbles and the station captions select
too and a per-element list grows a hole the next time somebody adds text. The
canvas has said the same thing since day one, with `select-none` on its `<svg>`.

⚠ **The open hand is a claim, so it is only made when it is true.** At fit-to-window
the whole room is in frame and `onPointerDown` refuses to start a pan; a `grab`
cursor there would promise a gesture that does nothing. The class is written by
`applyCam`, the one function every zoom change already passes through.

### 17j″. The same complaint, a third time — and the answer is to remove the journey

> *"Yes, selecting now shows the FULL wire. But tracing along it is still very
> hard: the moment it meets a node it un-selects and the node wins. I still
> cannot delete a connection cleanly."*

Three rounds on one door, and each fix was correct and insufficient:

| round | what was wrong | what was fixed |
|---|---|---|
| 3 | the ✕ sat **under** the nodes | the button moved into `.edge-tools`, above them |
| 4 | only the **button** lifted; the wire lit up in fragments | a lifted copy of the whole wire (§17j′) |
| **4b** | the pointer still has to **travel** from wire to button | ⇒ **it does not have to travel at all** |

**Point at the wire and press Delete.** The mouse never leaves the wire. Clicking
first *latches* the edge so the pointer is then free to go anywhere. Everything
else is a backstop around that:

⚠ **The key acts on the wire that is LIT, not on the one that is latched.** They
are two different answers whenever the pointer is previewing a second edge, and a
shortcut that cut the latched one would delete a wire the user cannot see
highlighted. Reading what is on screen is also what hands hover users the shortcut
without them having to learn about latching at all.

- the latch is now **visible** — `.is-stuck` thickens the lifted wire and fills
  the button solid. In the first cut a latched edge looked identical to a hovered
  one, so the click produced no change on screen and the user went on tracing.
  **A state nobody can see is a state nobody uses**, and that is the whole reason
  round 4 did not land.
- the hover grace went **90 ms → 320 ms**, which is a measurement of the real
  gesture rather than a nicer number: the pointer going from a wire to that wire's
  own button crosses whatever the diagram put in between, and here that is usually
  a node. ⚠ It is only a backstop — a pointer can dwell over that node for as long
  as it likes, so a preview that expires can always be outlasted.
- Escape lets go; Delete and Backspace cut. ⚠ **Not while a text field is
  focused** — the chat box and every inspector input share this `window`, and
  Backspace there must delete a character.

⚠ **The keydown effect is declared BELOW `cutEdge` and must stay there.** The
dependency array is evaluated during render and a `const` does not hoist, so the
same effect written above it throws before the canvas paints. This session already
paid for that exact shape once, in `store.ts`.

### 17j‴. The corridor — a wire's reach widens only once it is LIT

> *"The connection part still is not smooth. Should the wire's select region be
> widened, parallel to it, WHILE IT IS SELECTED — and left as it is when it is
> not, so picking one by accident stays annoying-free?"*

Yes, and the second half is the design. Two regions, not one:

| | |
|---|---|
| **to CHOOSE a wire** | the 16-unit hit path, unchanged, still **under** the nodes |
| **to KEEP a lit wire** | `WIRE_REACH` = **48** world units around the whole curve |

🔴 **It is a DISTANCE, not a wider hit path, and that is the whole thing.** A
96-unit transparent stroke laid over the diagram while an edge is lit would own
every pixel it covers: the nodes the wire runs *through* would go dead exactly
while the user is looking at that wire — and clicking a node is the escape from
the latch, so the widening would eat its own way out. The corridor lives entirely
in a `pointermove` comparison and takes nothing from anybody.

⚠ **48** is under a third of an employee node's width (168). Wide enough to hold
the wire while the pointer wanders or crosses a node; narrow enough that two wires
are only ever both inside it where they are already converging on the same box —
and there the pointer is inside the box, not the corridor.

⚠ **The control points moved into `core`.** `curve()` in `web/.../geometry.ts` was
the only thing that knew where a wire actually runs, and it knew it as a `d`
string. The moment a second reader appeared — *"is the pointer near this wire"* —
the alternative was a second copy of the same two control points beside the
distance maths, which is precisely the pair `layout-geometry.ts` exists to delete.
`wireCurve()` returns the four points; `curve()` formats them; `nearWire()`
samples them.

⚠ **The sampling error is measured, and the first comment about it was a guess
that was wrong.** *"Accurate to well under a pixel"* — actual worst chord
deviation across the most extreme wires: **2.23** units at 24 chords (1.27 at 32,
0.58 at 48). 24 stays because 2.2 is under 5% of the corridor it lives in; raising
it would buy a number, not a behaviour. The first version of the test asked for
1 unit and went red — **the test was wrong, not the code**, and the number in it
now comes from the measurement rather than from what looked tidy.

⚠ **Sampled over SEGMENTS, not points.** At 24 samples a long wire's chords are
~35 units apart, so a pointer halfway between two of them would sit ~48 from both
and read as *far away* — for one frame, which is how a defect gets blamed on the
browser instead of on the function.

### 17k″. 🔴 The assistant lost its own colour every single time

> *"The assistant and the first four employees are all in their original garment.
> Then I pick a character for employee 5, it happens to be the assistant's, and
> now the ASSISTANT is not in its own colour any more. That makes no sense — and
> does it happen to workers too? Someone gets used to a colleague's colour and it
> changes for no reason they can see."*

§17k says *"every holder of a face except the first, in sorted order"*. Sorted by
**id** — and every worker is `agent:…` while the assistant is `assistant`, so
`'g' < 's'` and **a worker sorted first in every clash there has ever been**. The
one figure the room is drawn around, the one §17d says the user must never have to
hunt for, was the guaranteed loser.

Two wrongs were stacked in that one report, and the second is the general one:

| | |
|---|---|
| ① | the assistant was recoloured by **somebody else's** choice |
| ② | the person who **asked** for the face kept the original; the person already wearing it was put in a costume |

⇒ The order inside a face group is now `keeper()`: **the anchor (the assistant)
first, then everybody who did not hand-pick this face, then the hand-pickers**,
with the id as the last tiebreak so the answer still cannot depend on the order a
browser dragged `layout.nodes` into. ① is a special case of ②: **a change lands on
whoever caused it.**

⚠ **`core` does not decide that the assistant is special.** `office.ts` passes
`anchor: ASSISTANT_NODE`, the same way the renderer is told `onTop` rather than
told who this is.

⚠ **A stored pick of `7` is a pick of face `2`.** `layout.cast` legitimately holds
0…9 while there are five drawings; reading the value raw would let a picker
quietly keep the original after all.

🔴 **WHAT THIS DOES NOT FIX, and it is the user's second question.** Hiring a
worker whose id sorts **before** an incumbent on the same face still moves the
incumbent's colour — and firing anybody can re-deal faces outright (the cost §17k
and `assignCast` both already state). *A hand pick is the only "who caused it"
this function can observe*, because **nothing on disk records who arrived first**.

Closing that means storing the face and the colour **at the moment the roster
changes** — `placeAgent` on hire, `saveCanvas` on a pick — which are genuine write
moments, unlike `canvas()`. It is a real option with a real price, and it is an
open decision rather than an oversight:

| | |
|---|---|
| **buys** | nobody's appearance ever changes unless the user changes it |
| **costs** | `layout.json` accumulates a `cast` + `tint` entry for every person, so *"delete `layout.json` and the office re-casts itself"* stops being true in practice; and a face freed by a departure is never reclaimed, so a long-lived office drifts towards everybody frozen on whatever they were first dealt |

### 17k‴. 🔴 One pick, six people changed — the cast is frozen at the pick

> *"When I change the shirt colour or the character of ONE person who is on a
> break, do not re-render the whole break area. Toggle and F5 only. Right now
> changing a character moves the whole break area and people look wrong — I
> expected only that character to change."*

**The seats were never the problem.** `dealSeats` keeps every prior entry, so
nobody moves cushion. What moves is the **face**, and a face carries a per-sheet
`scale` and a `sitLift` — so a seated figure with a new face visibly jumps.

🔴 **MEASURED, an office of 12 on 5 faces, one hand pick:**

| payload | other people whose FACE changed |
|---|---|
| `{stored choices ∪ this pick}` — what `setCharacter` used to send | **up to 6 of 11**, plus 4 garment colours |
| `{resolved cast ∪ this pick}` — what it sends now | **0**, in 234 hires and 156 picks across six offices |

A reserved face is seated *before* the rest are dealt, so reserving one cascades
through everybody the probe walks past. Nothing was wrong with `assignCast`; the
payload was asking it the wrong question.

⇒ **`setCharacter` freezes the resolved cast and changes one entry in it.** A pick
is a deliberate act on a screen the user is watching and it is already a write, so
the objection §17k raises against storing — *a READ that writes and emits
`layout.changed`* — does not apply. `setTint` beside it has worked this way since
it shipped.

⚠ **The cost, and it is now the smaller one:** after the first pick the office's
whole cast sits in `layout.json`, so *"delete it and the office re-casts itself"*
holds only for an office nobody has ever dressed. Bounded by that first pick.

⚠ **It closes half of §17k″ as a side effect, not as a second mechanism.** In a
dressed office a stored face is honoured verbatim and `pruneCast` only drops the
leaver, so **hiring and firing stop restyling anybody** — measured: 0 face changes
across 234 hires.

⚠ **WHAT IT DOES NOT CLOSE, with the number.** Garment colour is still recomputed
from scratch, so a **hire** still moves a bystander's colour in **181 of 234**
cases: a newcomer landing on somebody's face forces one of them into a costume,
and with the cast frozen `layout.cast` no longer distinguishes *"I chose this"*
from *"this was pinned for me"*, so §17k″'s picker-yields rule cannot tell them
apart. A **pick** is clean — 702 cases, **0** colour changes outside the picker
and the two face groups they left and joined, which is the minimum any correct
implementation touches. Closing the hire case needs *"own colour"* to become a
STATED value in `layout.tint` rather than an absent entry; that is the §4.4 open
decision, not a defect of this change.
