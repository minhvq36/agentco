/**
 * LAYOUT GEOMETRY — a PURE module, shared by the server and the interface.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS FILE EXISTS                                                    │
 * │                                                                          │
 * │ Before 19/08 this math had TWO copies: `agentSlot` + hand-written default    │
 * │ coordinates in `layout.ts`, and `arrange()` in `web/src/canvas/geometry.ts`.   │
 * │ Both files carried a comment saying "⚠ must match the other side" — and they   │
 * │ had already drifted apart:                                                │
 * │                                                                          │
 * │   a NEW office (no layout.json yet)      assistant 520 · shelf 300/524          │
 * │   after clicking "Re-arrange diagram"     assistant 122 · shelf  26/250          │
 * │                                                                          │
 * │ The shelf row's center is 512 while the Assistant's is 636 → a 124px          │
 * │ mismatch the instant the office has nobody in it yet; adding one worker         │
 * │ pushes that to ~400px. The user sees a lopsided diagram, clicks "Re-arrange",   │
 * │ and it straightens out — meaning the system contradicts itself.                │
 * │                                                                          │
 * │ A comment is not a mechanism. Both sides IMPORTING THE SAME function            │
 * │ makes this bug impossible to happen again, and nobody has to remember           │
 * │ anything.                                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Imports NOTHING but types — not even `node:*`. This is the condition that
 * lets `web/` (runs in the browser, built separately with Vite) load this file at all.
 */

export type NodeKind = 'assistant' | 'agent' | 'knowledge' | 'library' | 'mcp';

export interface Point {
  x: number;
  y: number;
}

/**
 * 🔴 THE SHAPE OF A WIRE, AS FOUR POINTS. → SPEC-office-animation.md §17j‴
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CURVE HAD ONE AUTHOR AND NOW HAS TWO READERS, so it stops being a    │
 * │ string.                                                                  │
 * │                                                                          │
 * │ `web/.../geometry.ts §curve` used to build the `d` attribute from these  │
 * │ control points inline, and it was the only thing that knew them. The     │
 * │ moment a SECOND reader appeared — *"is the pointer near this wire"* —    │
 * │ the choice was to re-derive the same two control points beside the       │
 * │ distance maths, which is the pair of copies this file was created to     │
 * │ delete (see the header). The points move here; the string is formatted   │
 * │ from them; nothing can disagree about where the wire actually runs.      │
 * │                                                                          │
 * │ ⚠ `up` flips BOTH control points. Leaving one is how the curve knots in  │
 * │ the middle — it tries to bulge downward while both ends travel up.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * @returns `[start, control1, control2, end]` of a cubic Bezier, world units.
 */
export function wireCurve(a: Point, b: Point, up = false): [Point, Point, Point, Point] {
  // `dy` scales with distance so short wires do not bulge.
  const dy = Math.max(45, Math.abs(b.y - a.y) / 2);
  const s = up ? -1 : 1;
  return [a, { x: a.x, y: a.y + dy * s }, { x: b.x, y: b.y - dy * s }, b];
}

/**
 * 🔴 HOW FAR FROM A WIRE THE POINTER MAY STRAY WHILE THAT WIRE IS LIT.
 * → SPEC-office-animation.md §17j‴
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE USER'S PROPOSAL, AND THE HALF OF IT THAT MATTERS IS THE SECOND HALF: │
 * │ *"widen the wire's select region while it IS selected — but leave it as  │
 * │ it is when it is not, so picking one by accident stays hard."*           │
 * │                                                                          │
 * │ ⚠ IT IS A DISTANCE, NOT A WIDER HIT PATH, and that is the whole design.  │
 * │ A 96-unit transparent stroke laid over the diagram while an edge is lit  │
 * │ would own every pixel it covers: the nodes the wire runs THROUGH become  │
 * │ unclickable exactly while the user is looking at that wire, and the      │
 * │ escape from the latch — click a node — is the thing it would eat. The    │
 * │ hit path stays 16 units and stays under the nodes; this widening lives   │
 * │ entirely in a `pointermove` comparison and takes nothing from anybody.   │
 * │                                                                          │
 * │ ⚠ 20, TUNED DOWN FROM 48 BY HAND. 48 was picked as "under a third of a   │
 * │ node's width"; sitting in front of the diagram said otherwise, and the   │
 * │ number that survives is the one somebody felt rather than the one that   │
 * │ had a tidy derivation. It is still comfortably wider than the 16-unit    │
 * │ hit path, which is the only thing it has to beat to be worth having.     │
 * │                                                                          │
 * │ ⚠ NARROWING IT MADE THE SAMPLING BELOW MATTER MORE, and that is not      │
 * │ obvious from this line: the chord error is a fixed number of units, so   │
 * │ halving the corridor doubles its share of it. `N` moved 24 → 48 in the   │
 * │ same change to keep the ripple under 5% of the corridor's edge.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const WIRE_REACH = 20;

/**
 * Is `p` within `reach` world units of the wire from `a` to `b`?
 *
 * ⚠ SAMPLED, not solved. The exact distance from a point to a cubic is a
 * quintic; a few dozen chords cost nothing next to the pointer event that asked.
 *
 * ⚠ THE ERROR IS MEASURED, NOT ASSUMED. The first draft of this comment said
 * *"accurate to well under a pixel"*, which was a guess and was wrong. Worst
 * chord deviation across the most extreme wires this diagram produces:
 *
 *   N=24 → 2.23    N=32 → 1.27    N=48 → 0.58    N=64 → 0.32
 *
 * 🔴 **N IS CHOSEN AGAINST `WIRE_REACH`, NOT AGAINST ZERO.** The bound that
 * matters is the ripple as a SHARE of the corridor's edge, so the two numbers
 * move together: at a 48-unit corridor, 24 chords (2.23 ⇒ 4.6%) was enough; when
 * the corridor was tuned down to 20 the same 24 became 11%, and N went to 48
 * (0.58 ⇒ 2.9%). Narrowing the corridor without noticing this is silent — the
 * absolute error never changed, only what it is measured against.
 *
 * ⚠ Over SEGMENTS rather than points: a long wire's chords are tens of units
 * apart, so a pointer halfway between two samples would sit further from both
 * than from the curve and read as "far away" — for one frame, which is exactly
 * how a defect gets blamed on the browser instead of on this function.
 */
export function nearWire(
  a: Point,
  b: Point,
  up: boolean,
  p: Point,
  reach: number = WIRE_REACH,
): boolean {
  const [p0, p1, p2, p3] = wireCurve(a, b, up);
  const at = (t: number): Point => {
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    return {
      x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
      y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
    };
  };
  // → the box above: 48 chords keep the ripple at 2.9% of a 20-unit corridor.
  const N = 48;
  let prev = at(0);
  for (let i = 1; i <= N; i++) {
    const next = at(i / N);
    if (distToSegment(p, prev, next) <= reach) return true;
    prev = next;
  }
  return false;
}

/** Shortest distance from `p` to the segment `v…w`. */
function distToSegment(p: Point, v: Point, w: Point): number {
  const dx = w.x - v.x;
  const dy = w.y - v.y;
  const len = dx * dx + dy * dy;
  // A zero-length segment is a point — `t` would be `0/0`.
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - v.x) * dx + (p.y - v.y) * dy) / len));
  return Math.hypot(p.x - (v.x + t * dx), p.y - (v.y + t * dy));
}

/** Node dimensions. Server and client MUST agree so their layouts match. */
/**
 * ⚠ Shrunk on 23/08 (the user's call). The old diagram ran out of room fast:
 * four workers alone took up 944px horizontally, and every extra row pushed
 * the two shelves down another 148px.
 *
 * A smaller node loses NO information at all — the text inside a node was
 * already truncated (`cut(node.label, 17)`); what was taking up space was padding.
 */
export const NODE_SIZE: Record<NodeKind, { w: number; h: number }> = {
  assistant: { w: 200, h: 72 },
  agent: { w: 168, h: 76 },
  knowledge: { w: 184, h: 58 },
  library: { w: 184, h: 58 },
  mcp: { w: 152, h: 52 },
};

/** Number of workers per row before wrapping. */
export const PER_ROW = 4;

const ORIGIN_X = 140;
const ORIGIN_Y = 210;
const COL_GAP = 34;
const ROW_GAP = 44;
/** Gap between the two shelves on the bottom row. */
export const SHELF_GAP = 24;
/** Minimum distance between two nodes for the eye to read them as "two separate things". */
const CLEARANCE = 24;
const SHELF_DROP = 30;
const MAX_SLOTS = 200;

/** The grid step. Every worker slot — including ones that grow to the left — lies on this grid. */
const COL_STEP = NODE_SIZE.agent.w + COL_GAP;
const ROW_STEP = NODE_SIZE.agent.h + ROW_GAP;

export interface ArrangeNode {
  id: string;
  kind: NodeKind;
  /**
   * The SORT key for an arm sitting in the parking area — a string, compared with `localeCompare`.
   *
   * ⚠ Computed by the **caller**, not this file. Geometry isn't allowed to
   * know what "Notion" or "Linear" are; sorting vendors is **catalog data**.
   * Current convention: `0-files` · `1-<catalog entry>` · `2-custom` ⇒
   * filesystem first, then providers (same-vendor providers sit next to each
   * other since they share a prefix), then custom-pasted ones. → `layout.ts §armGroup`
   */
  armGroup?: string;
}

export interface ArrangeEdge {
  from: string;
  to: string;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PARKING AREA FOR UNWIRED ARMS — to the left, outside the main diagram.       │
 * │ (user, 31/08)                                                            │
 * │                                                                          │
 * │ The constants below are **taken from the layout the user actually dragged        │
 * │ by hand** in `offices/canh-tay/layout.json`, not made up:                        │
 * │                                                                          │
 * │   col 1  x ≈ −133…−139      col 2  x ≈ −309…−312   ⇒ step ≈ 177                 │
 * │   y      0 · 72 · 143 · 217 · 292 · 376 · 459      ⇒ step ≈ 72, EXACTLY 7        │
 * │   starting y = 0, **higher than the Assistant** (y=40) — the user named this        │
 * │   reference point explicitly                                              │
 * │                                                                          │
 * │ Taking the numbers from something the user already built means "re-arrange"      │
 * │ doesn't jerk things around: it settles back to roughly where they already had it.│
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const PARK_PER_COL = 7;
/** Visible gap between two nodes in the parking area. Every step below is derived from it. */
const PARK_GAP = 20;
const PARK_ROW_STEP = NODE_SIZE.mcp.h + PARK_GAP; // 72 — the exact step the user dragged by hand
const PARK_COL_STEP = NODE_SIZE.mcp.w + PARK_GAP; // 172
/**
 * 🔴 The HORIZONTAL GAP between the parking area and the main diagram. **This is the number to adjust if it's still too far/close.**
 *
 * The user, 31/08: *"the x gap right now is a bit too far, bring it closer to
 * the bottom of the triangle, I guess gap x = gap y, something like that"*.
 *
 * Before: the first column sat at `x = -133` ⇒ right edge = 19, while the
 * diagram's left edge is `ORIGIN_X` = 140 ⇒ a **121px** gap. Now set to
 * exactly ONE of the parking area's own vertical steps (72) — "gap x = gap
 * y" meaning the same grid step. A gap of 20 (equal to the gap between two
 * nodes) would make the parking area stick to the diagram and read as **the
 * same row** to the eye, losing the whole point of "a row set apart for the unused ones".
 */
const PARK_CLEAR = PARK_ROW_STEP;
const PARK_X = ORIGIN_X - PARK_CLEAR - NODE_SIZE.mcp.w;
const PARK_Y = 0;

/** Slot `i` of the parking area: fills one column (7) then opens a new column **to the left**. */
export function parkSlot(i: number): Point {
  return {
    x: PARK_X - Math.floor(i / PARK_PER_COL) * PARK_COL_STEP,
    y: PARK_Y + (i % PARK_PER_COL) * PARK_ROW_STEP,
  };
}

/**
 * A slot for a NEW arm, following its owner.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 BUG the user caught, 31/08: *"every time I add a new MCP, the spot it       │
 * │ picks is really bad… it lands far away"*.                                 │
 * │                                                                          │
 * │ The culprit: `firstFreeSlot` walked the **WORKER grid** for every node type.     │
 * │ That grid's step is 202×120 — far too coarse for a 152×52 node — so it skipped     │
 * │ over every real open gap and landed all the way at the edge of the diagram. With    │
 * │ the layout the user already had (workers, two shelves, and a parking area dragged    │
 * │ to the left), the first open slot on that grid was very far away.                    │
 * │                                                                          │
 * │ ⇒ Arms need their OWN grid: a step sized to match them, scanning HORIZONTALLY       │
 * │ right below their owner, fanning out to both sides before wrapping to a new row.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function armSlot(i: number, centerX: number, topY: number): Point {
  const step = NODE_SIZE.mcp.w + COL_GAP;
  const perRow = 7;
  const j = i % perRow;
  // 0, +1, −1, +2, −2… — fans out from the axis, same shape as `centeredSlot`.
  const off = j === 0 ? 0 : j % 2 === 1 ? Math.ceil(j / 2) : -(j / 2);
  return {
    x: Math.round(centerX - NODE_SIZE.mcp.w / 2 + off * step),
    y: topY + Math.floor(i / perRow) * (NODE_SIZE.mcp.h + ROW_GAP),
  };
}

/** Grid slot `i` of the worker row, counted from LEFT to right. */
export function agentSlot(i: number): Point {
  return {
    x: ORIGIN_X + (i % PER_ROW) * COL_STEP,
    y: ORIGIN_Y + Math.floor(i / PER_ROW) * ROW_STEP,
  };
}

/**
 * Slot `i` when the worker row GROWS AROUND AN AXIS, rather than chaining rightward.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY `agentSlot` ISN'T USED FOR A NEW PERSON (20/08).                       │
 * │                                                                          │
 * │ `agentSlot` counts left to right, so adding a third person drops them into      │
 * │ the third slot — to the right of the second person. The Assistant STAYS PUT      │
 * │ (it only gets re-centered when "Re-arrange diagram" is clicked), so the diagram    │
 * │ visibly tilts to the right and the user has to click Re-arrange just to see it      │
 * │ balanced. A system's own error-correction step should never sit in the user's        │
 * │ hands.                                                                    │
 * │                                                                          │
 * │ The order here is the exact order the user themselves described when reporting     │
 * │ the bug:                                                                  │
 * │                                                                          │
 * │   person 1 → directly under the Assistant  (offset 0)                        │
 * │   person 2 → to the right of person 1      (offset +1, an even count can't balance) │
 * │   person 3 → to the LEFT of person 1       (offset −1, the row balances again)     │
 * │   person 4 → +2 … then wraps to the next row                                 │
 * │                                                                          │
 * │ Still the EXACT SAME GRID as `agentSlot`, only the TRAVERSAL ORDER differs:       │
 * │ `kc` is the column index holding the axis, rounded to the grid. Without staying     │
 * │ on the grid, a new slot would land half a column off and half-overlap the previous   │
 * │ person — far worse than just leaning right.                                        │
 * │                                                                          │
 * │ Each row still holds only `PER_ROW` columns (offsets −1…+2), so the diagram         │
 * │ doesn't grow sideways forever: the fifth person drops to the row below, on axis,     │
 * │ exactly like `arrangeAll`.                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function centeredSlot(i: number, centerX: number): Point {
  const kc = Math.round((centerX - (ORIGIN_X + NODE_SIZE.agent.w / 2)) / COL_STEP);
  const j = i % PER_ROW;
  // 0, +1, −1, +2 — the first `PER_ROW` columns of a series fanning out from the center.
  const off = j === 0 ? 0 : j % 2 === 1 ? Math.ceil(j / 2) : -(j / 2);
  return { x: ORIGIN_X + (kc + off) * COL_STEP, y: ORIGIN_Y + Math.floor(i / PER_ROW) * ROW_STEP };
}

/**
 * A clean layout for the ENTIRE diagram. This is what the "Re-arrange
 * diagram" button runs, and also what an office with no `layout.json` yet receives.
 *
 * Everything is centered around ONE axis: the center of the worker row. The
 * Assistant sits above, the two shelves below, all three on the same
 * vertical axis — otherwise the diagram looks lopsided even when nothing is
 * actually wrong.
 *
 * The two shelves sit side by side, knowledge LEFT and document cabinet
 * RIGHT: these are the two easiest concepts to confuse in the product, so
 * they must be visible AT THE SAME TIME for the "the system learns it" /
 * "you feed it in" distinction to read visually.
 */
export function arrangeAll(
  nodes: readonly ArrangeNode[],
  /**
   * `mcp → agent` edges. Omitted ⇒ the OLD behavior (every arm laid out in
   * one centered row) — every existing call site and every existing test keeps producing the same result.
   */
  edges: readonly ArrangeEdge[] = [],
): Map<string, Point> {
  const out = new Map<string, Point>();
  const agents = nodes.filter((n) => n.kind === 'agent');
  const mcps = nodes.filter((n) => n.kind === 'mcp');

  const { owned, parked } = groupArms(agents, mcps, edges);
  const blocks = edges.length > 0;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE ARM ROW DECIDES THE HORIZONTAL LAYOUT, NOT THE OTHER WAY AROUND.        │
   * │ (user, 31/08)                                                            │
   * │                                                                          │
   * │   *"workers have to balance with their own mcps"* ·                        │
   * │   *"the order has to follow the worker (to avoid wires crossing each          │
   * │    other)"*                                                               │
   * │                                                                          │
   * │ The old version placed workers on the grid first, then scattered ALL arms       │
   * │ into a single row centered on the whole diagram. Consequence: the leftmost       │
   * │ person's own arm could land on the right side, and every wire crossed every       │
   * │ other one.                                                                │
   * │                                                                          │
   * │ Reversed: each worker gets their own BLOCK of arms, blocks are laid out         │
   * │ side by side in worker order, and then **the worker gets centered over their     │
   * │ own block**. Wires become parallel bundles, none crossing another — because      │
   * │ an arm's horizontal order IS its owner's horizontal order.                       │
   * │                                                                          │
   * │ ⚠ Still exactly 4 tiers (the user's call: *"the 4-row model is still            │
   * │ correct"*). Past `PER_ROW` workers, each worker ROW gets its own arm row right     │
   * │ below it — the only way to keep "an arm sits below its owner" without two          │
   * │ rows overlapping.                                                         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const rowsOf: ArrangeNode[][] = [];
  for (let i = 0; i < agents.length; i += PER_ROW) rowsOf.push(agents.slice(i, i + PER_ROW));
  if (!rowsOf.length) rowsOf.push([]);

  const armStep = NODE_SIZE.mcp.w + COL_GAP;
  /** A worker's block width: whichever is wider between the person and their pile of arms. */
  const blockW = (a: ArrangeNode): number => {
    const n = blocks ? (owned.get(a.id)?.length ?? 0) : 0;
    return Math.max(NODE_SIZE.agent.w, n ? n * armStep - COL_GAP : 0);
  };

  /** The width of the widest row — this defines the diagram's own center axis. */
  let widest = 0;
  for (const row of rowsOf) {
    const w = row.reduce((s, a) => s + blockW(a), 0) + Math.max(0, row.length - 1) * COL_GAP;
    widest = Math.max(widest, w);
  }
  if (!widest) widest = NODE_SIZE.agent.w;
  const mid = ORIGIN_X + widest / 2;

  // Places each row: block after block, the whole row centered on the axis.
  let y = ORIGIN_Y;
  for (const row of rowsOf) {
    const rowW = row.reduce((s, a) => s + blockW(a), 0) + Math.max(0, row.length - 1) * COL_GAP;
    let x = Math.round(mid - rowW / 2);
    for (const a of row) {
      const w = blockW(a);
      out.set(a.id, { x: Math.round(x + w / 2 - NODE_SIZE.agent.w / 2), y });
      const mine = blocks ? (owned.get(a.id) ?? []) : [];
      if (mine.length) {
        const armW = mine.length * armStep - COL_GAP;
        const armX = Math.round(x + w / 2 - armW / 2);
        const armY = y + NODE_SIZE.agent.h + ROW_GAP + SHELF_DROP;
        mine.forEach((m, i) => out.set(m.id, { x: armX + i * armStep, y: armY }));
      }
      x += w + COL_GAP;
    }
    y += NODE_SIZE.agent.h + ROW_GAP + (blocks ? NODE_SIZE.mcp.h + SHELF_DROP + ROW_GAP : 0);
  }

  /**
   * UNWIRED ARMS → PARKING AREA ON THE LEFT. (the user's call, 31/08)
   *
   * *"unused mcps get laid out in vertical columns as far left as possible,
   * max 7 per column… sorted by type (filesystem, provider, custom), and
   * within provider also sorted by provider."*
   *
   * ⚠ The order comes from `armGroup` — a string computed by the **caller**,
   * not here. This file isn't allowed to know what "Notion" or "Linear" are:
   * it is pure geometry, while sorting by vendor is **catalog data**. Mixing
   * that in is exactly what `arms/index.ts` built a fence to block.
   */
  parked
    .slice()
    .sort((a, b) => (a.armGroup ?? '~').localeCompare(b.armGroup ?? '~') || a.id.localeCompare(b.id))
    .forEach((n, i) => out.set(n.id, parkSlot(i)));

  const rows = rowsOf.length;

  /**
   * FOUR TIERS, and this order reads as a SENTENCE from top to bottom:
   *
   *   Assistant   delegates work
   *   workers     do the work
   *   arms        ← right below whoever uses it, wires as short as possible
   *   two shelves the floor, because they're the FOUNDATION of the whole office
   *
   * ⚠ The morning-of-23/08 version put arms BELOW the two shelves. The user
   * rejected it: *"the 2 shelves belong at the very bottom tier"*. And beyond
   * the hierarchy, it was also geometrically wrong: the wire from an arm up
   * to its worker had to loop around the two shelves, drawing an odd-looking arc.
   */
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 THE ARM ROW RESERVES ITS SPACE EVEN WHEN IT'S EMPTY. (the user caught       │
   * │ this, 31/08)                                                              │
   * │                                                                          │
   * │   *"When creating a new office: the height gap between the assistant and         │
   * │    the knowledge shelf | document cabinet isn't wide enough for a worker         │
   * │    and an mcp ⇒ when an MCP gets created it has no room, it has to climb out       │
   * │    somewhere else. Only fixed by Re-arranging."*                                 │
   * │                                                                          │
   * │ Measured: a new office ⇒ 0 arms ⇒ `armRow = 0` ⇒ the two shelves sit at            │
   * │ **y=360**. But the arm row's own spot is ALSO y=360. Connecting the first arm      │
   * │ ⇒ `clashes` with the two shelves ⇒ `armSlot` scans forever and lands elsewhere.     │
   * │ After clicking "Re-arrange", the two shelves drop to **y=442** and everything      │
   * │ fits — meaning the system **contradicts itself**, exactly the disease this          │
   * │ whole file exists to cure (see the block at the top of the file: *"the user          │
   * │ sees a lopsided diagram, clicks Re-arrange and it straightens out"*).              │
   * │                                                                          │
   * │ ⇒ Reserve the space **always**, without asking whether an arm exists yet.          │
   * │ The cost is ~82px of blank space in an office with nothing connected; in           │
   * │ exchange, **the layout at creation time equals the layout after re-arranging**       │
   * │ — an invariant worth more than a few dozen pixels.                                 │
   * │                                                                          │
   * │ ⚠ The BLOCK branch (`blocks`) already reserves space per row, so it's unchanged.    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const armRow = NODE_SIZE.mcp.h + SHELF_DROP;
  const armY = ORIGIN_Y + rows * (NODE_SIZE.agent.h + ROW_GAP) + SHELF_DROP;
  /**
   * The bottom edge of the two shelves: below the last row placed.
   *
   * In BLOCK mode, `y` has already run through every row (each row being a
   * worker plus their own arms), so it already IS the bottom edge — it can no
   * longer be recomputed from `rows`. The old mode keeps its old formula, unchanged.
   */
  const shelfY = blocks ? y - ROW_GAP + SHELF_DROP : armY + armRow;
  const shelfW = NODE_SIZE.knowledge.w + SHELF_GAP + NODE_SIZE.library.w;
  const shelfX = Math.round(mid - shelfW / 2);

  for (const n of nodes) {
    if (n.kind === 'assistant') {
      out.set(n.id, { x: Math.round(mid - NODE_SIZE.assistant.w / 2), y: 40 });
    }
    if (n.kind === 'knowledge') out.set(n.id, { x: shelfX, y: shelfY });
    if (n.kind === 'library') {
      out.set(n.id, { x: shelfX + NODE_SIZE.knowledge.w + SHELF_GAP, y: shelfY });
    }
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ARMS LAID OUT IN ONE CENTERED ROW AT THE BOTTOM. (changed 23/08, user's       │
   * │ call)                                                                     │
   * │                                                                          │
   * │ The earlier version stacked them into a COLUMN on the right, running down       │
   * │ from y=40. Two mistakes at once, and the user caught both on the very first       │
   * │ test:                                                                     │
   * │                                                                          │
   * │  1. It cuts across the vertical axis the whole diagram is centered on.          │
   * │     Assistant on top, workers in the middle, two shelves at the bottom —          │
   * │     then a strange column sprouting off to the side.                             │
   * │  2. **Wrong FLOW DIRECTION.** The edge is `mcp → agent`, meaning an arm             │
   * │     FEEDS a worker. Placing it level with the worker's shoulder makes the           │
   * │     wire run sideways, and the eye can't read who's supplying what to whom.         │
   * │                                                                          │
   * │ Placing it at the very bottom turns the whole diagram's grammar into a readable    │
   * │ sentence: **work flows top-down, resources push bottom-up.** The two shelves        │
   * │ and the arms both sit at the bottom tier because they're both things a worker        │
   * │ REACHES for.                                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  // ⚠ ONLY runs in the old mode (no edges). With edges, arms are already
  // placed by block above, and re-running this loop would wipe that out.
  if (!blocks && mcps.length) {
    const oneRow = NODE_SIZE.mcp.w + COL_GAP;
    const armW = mcps.length * oneRow - COL_GAP;
    const armX = Math.round(mid - armW / 2);
    mcps.forEach((n, i) => out.set(n.id, { x: armX + i * oneRow, y: armY }));
  }

  return out;
}

/**
 * Which arm belongs to which worker — and which ones belong to **nobody**.
 *
 * ⚠ THE OWNER = whoever stands LEFTMOST among those holding it. A shared arm
 * has to pick exactly one place to stand; picking the leftmost person means
 * the second wire always runs RIGHTWARD, in the same direction as every
 * other wire — instead of having some wires veer left and others veer right,
 * crossing each other right below the worker row.
 */
function groupArms(
  agents: readonly ArrangeNode[],
  mcps: readonly ArrangeNode[],
  edges: readonly ArrangeEdge[],
): { owned: Map<string, ArrangeNode[]>; parked: ArrangeNode[] } {
  const order = new Map(agents.map((a, i) => [a.id, i]));
  const holders = new Map<string, string[]>();
  for (const e of edges) {
    if (!order.has(e.to)) continue;
    const list = holders.get(e.from);
    if (list) list.push(e.to);
    else holders.set(e.from, [e.to]);
  }
  const owned = new Map<string, ArrangeNode[]>();
  const parked: ArrangeNode[] = [];
  for (const m of mcps) {
    const hs = holders.get(m.id);
    if (!hs?.length) {
      parked.push(m);
      continue;
    }
    const boss = hs.reduce((best, h) => (order.get(h)! < order.get(best)! ? h : best));
    const list = owned.get(boss);
    if (list) list.push(m);
    else owned.set(boss, [m]);
  }
  return { owned, parked };
}

/** Do two rectangles touch (already padded with the visible gap)? */
export function clashes(
  spot: Point,
  kind: NodeKind,
  placed: readonly { kind: NodeKind; x: number; y: number }[],
): boolean {
  const mine = NODE_SIZE[kind];
  return placed.some((n) => {
    const s = NODE_SIZE[n.kind];
    return (
      spot.x < n.x + s.w + CLEARANCE &&
      n.x < spot.x + mine.w + CLEARANCE &&
      spot.y < n.y + s.h + CLEARANCE &&
      n.y < spot.y + mine.h + CLEARANCE
    );
  });
}

/**
 * The first grid slot that does NOT touch any already-placed node.
 *
 * Checked with real rectangles rather than "do the coordinates match
 * exactly": the user can drag a node anywhere, so two nodes 10px apart still
 * read as overlapping to the eye. This is where the "added a worker and
 * nothing appeared" bug gets blocked at the root — nobody has to remember which function to call.
 *
 * `centerX` = the horizontal center of the AXIS (in practice: the Assistant
 * node). With an axis, slots fan out to both sides (`centeredSlot`); without
 * one, it falls back to counting-from-the-left. Both paths use THE SAME
 * grid, so mixing them never produces a node offset by half a column.
 *
 * Has a loop ceiling: run out of slots and it returns the last one — better
 * two nodes overlapping than hanging forever.
 */
export function firstFreeSlot(
  placed: readonly { kind: NodeKind; x: number; y: number }[],
  kind: NodeKind = 'agent',
  centerX?: number,
): Point {
  const slotAt = (i: number): Point =>
    centerX === undefined ? agentSlot(i) : centeredSlot(i, centerX);
  for (let i = 0; i < MAX_SLOTS; i++) {
    const slot = slotAt(i);
    if (!clashes(slot, kind, placed)) return slot;
  }
  return slotAt(placed.length);
}
